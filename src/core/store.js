const STORAGE_KEY = 'sinergia_ucm_state_v2';

const EMPTY_STATE = {
  myProfileId: null,
  profiles: [],
  encounters: [],
  savedIds: [],
  syncStatus: 'local'
};

/**
 * Codifica un objeto JSON a Base64URL seguro para UTF-8.
 */
export function encodePayload(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodifica un token Base64URL UTF-8 a objeto JS.
 */
export function decodePayload(token) {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Valida un diccionario de datos contra una definición de campos del esquema SSOT.
 */
export function validateBySchema(fields, values) {
  const errors = [];
  for (const field of fields) {
    const raw = values[field.id];
    const isEmpty = Array.isArray(raw) ? raw.length === 0 : !String(raw ?? '').trim();
    if (field.required && isEmpty) {
      errors.push(`El campo "${field.label}" es obligatorio.`);
      continue;
    }
    if (field.type === 'email' && raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw).trim())) {
      errors.push(`Ingresa un correo válido en "${field.label}".`);
    }
  }
  return errors;
}

/**
 * Genera un identificador único legible sin dependencias externas.
 */
function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Resuelve el bloque macro (Vicerrectoría) desde el catálogo oficial SSOT.
 */
export function resolveMacroUnidad(modelo, areaName) {
  const target = String(areaName || '').trim().toLowerCase();
  for (const grupo of modelo.organigramaUCM || []) {
    if (grupo.unidades.some((u) => u.toLowerCase() === target)) {
      return { macroId: grupo.macroId, macroNombre: grupo.macroNombre };
    }
  }
  return { macroId: 'otra', macroNombre: 'Otra Unidad / Proyecto UCM' };
}

function normalizeArrayField(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function sanitizeProfile(profile, modelo) {
  const macro = resolveMacroUnidad(modelo, profile.area);
  const rawSeconds = Number(profile.duracionSegundos);
  return {
    id: profile.id || createId('prof'),
    nombre: String(profile.nombre || '').trim(),
    correo: String(profile.correo || '').trim().toLowerCase(),
    area: String(profile.area || '').trim(),
    macroId: profile.macroId || macro.macroId,
    macroNombre: profile.macroNombre || macro.macroNombre,
    cargo: String(profile.cargo || '').trim(),
    antiguedad: String(profile.antiguedad || '').trim(),
    queHace: String(profile.queHace || '').trim(),
    temasAyudo: normalizeArrayField(profile.temasAyudo),
    detalleAyudo: String(profile.detalleAyudo || '').trim(),
    temasBusco: normalizeArrayField(profile.temasBusco),
    detalleBusco: String(profile.detalleBusco || '').trim(),
    conductaFortaleza: String(profile.conductaFortaleza || ''),
    interesesComunes: normalizeArrayField(profile.interesesComunes),
    datoOnboarding: String(profile.datoOnboarding || '').trim(),
    disponibilidad: String(profile.disponibilidad || '').trim(),
    duracionSegundos: Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.round(rawSeconds) : null,
    updatedAt: profile.updatedAt || new Date().toISOString()
  };
}

function buildSupabaseHeaders(anonKey, extra = {}) {
  const headers = { apikey: anonKey, ...extra };
  if (String(anonKey).startsWith('eyJ')) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  return headers;
}

/**
 * Contenedor único de estado (SSOT en tiempo de ejecución) con soporte híbrido:
 * lectura desde repo JSON + persistencia local + adaptador opcional webhook/Supabase.
 */
export function createStore(modelo) {
  let state = loadLocalState();
  const listeners = new Set();

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(EMPTY_STATE);
      const parsed = JSON.parse(raw);
      return {
        myProfileId: typeof parsed.myProfileId === 'string' ? parsed.myProfileId : null,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        encounters: Array.isArray(parsed.encounters) ? parsed.encounters : [],
        savedIds: Array.isArray(parsed.savedIds) ? parsed.savedIds : [],
        syncStatus: 'local'
      };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  function persistLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      myProfileId: state.myProfileId,
      profiles: state.profiles,
      encounters: state.encounters,
      savedIds: state.savedIds
    }));
    notify();
  }

  function notify() {
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot);
  }

  function getState() {
    return structuredClone(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getMyProfile() {
    return state.profiles.find((p) => p.id === state.myProfileId) || null;
  }

  function mergeProfile(rawProfile, markAsMine = false) {
    if (!rawProfile || !rawProfile.nombre || !rawProfile.area || !rawProfile.correo) {
      throw new Error('La ficha no contiene nombre, unidad y correo institucional.');
    }
    const clean = sanitizeProfile(rawProfile, modelo);
    const idx = state.profiles.findIndex(
      (p) => p.id === clean.id || p.correo === clean.correo
    );
    if (idx >= 0) {
      const preservedId = state.profiles[idx].id;
      const wasMine = preservedId === state.myProfileId;
      state.profiles[idx] = { ...clean, id: preservedId };
      if (markAsMine || wasMine) state.myProfileId = preservedId;
      return state.profiles[idx];
    }
    state.profiles.push(clean);
    if (markAsMine) state.myProfileId = clean.id;
    return clean;
  }

  async function pushToRemote(profile) {
    const cfg = modelo.storageConfig || {};

    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      const table = cfg.supabaseTable || 'cuestionarios_sinergia';
      const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=correo`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildSupabaseHeaders(cfg.supabaseAnonKey, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        }),
        body: JSON.stringify({ id: profile.id, correo: profile.correo, payload: profile, updated_at: profile.updatedAt })
      });
      if (!res.ok) throw new Error(`Error Supabase (${res.status})`);
      return 'supabase';
    }

    if (cfg.webhookUrl) {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'cuestionario_sinergia', profile })
      });
      if (!res.ok) throw new Error(`Error webhook (${res.status})`);
      return 'webhook';
    }

    return 'local';
  }

  /**
   * Sincroniza respuestas guardadas en la carpeta del repo y/o Supabase si están configuradas.
   */
  async function syncFromSources({ background = false } = {}) {
    const cfg = modelo.storageConfig || {};
    const prevSnapshot = JSON.stringify(state.profiles);
    let changed = false;

    if (!background && cfg.repoIndexUrl) {
      try {
        const res = await fetch(cfg.repoIndexUrl, { cache: 'no-store' });
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items)) {
            for (const item of items) {
              const p = item.profile || item;
              if (p?.nombre && p?.correo && p?.area) mergeProfile(p, false);
            }
            changed = JSON.stringify(state.profiles) !== prevSnapshot;
          }
        }
      } catch {
        // Sin índice remoto disponible todavía; se continúa con datos locales.
      }
    }

    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      try {
        const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${cfg.supabaseTable || 'cuestionarios_sinergia'}?select=payload`;
        const res = await fetch(endpoint, {
          headers: buildSupabaseHeaders(cfg.supabaseAnonKey)
        });
        if (res.ok) {
          const rows = await res.json();
          const remoteProfiles = rows
            .filter((row) => row?.payload?.nombre && row?.payload?.correo && row?.payload?.area)
            .map((row) => sanitizeProfile(row.payload, modelo));
          // En modo Supabase activo, la base en la nube es la fuente de verdad (SSOT) compartida.
          state.profiles = remoteProfiles;
          if (state.myProfileId && !state.profiles.some((p) => p.id === state.myProfileId)) {
            state.myProfileId = null;
          }
          const wasLocal = state.syncStatus !== 'supabase';
          state.syncStatus = 'supabase';
          changed = wasLocal || JSON.stringify(state.profiles) !== prevSnapshot;
        }
      } catch {
        if (state.syncStatus !== 'local-fallback') {
          state.syncStatus = 'local-fallback';
          changed = true;
        }
      }
    } else if (cfg.webhookUrl) {
      if (state.syncStatus !== 'github-webhook') {
        state.syncStatus = 'github-webhook';
        changed = true;
      }
    } else if (state.syncStatus !== 'local') {
      state.syncStatus = 'local';
      changed = true;
    }

    if (changed) persistLocal();
  }

  async function saveMyInterview(values, { markAsMine = true } = {}) {
    const saved = mergeProfile(values, markAsMine);
    persistLocal();
    let remoteMode = 'local';
    let remoteError = null;
    try {
      remoteMode = await pushToRemote(saved);
    } catch (err) {
      remoteError = err.message;
    }
    return { profile: saved, remoteMode, remoteError };
  }

  function removeProfile(profileId) {
    state.profiles = state.profiles.filter((p) => p.id !== profileId);
    if (state.myProfileId === profileId) state.myProfileId = null;
    persistLocal();
  }

  function addEncounter(values) {
    const record = {
      id: createId('enc'),
      ...values,
      createdAt: new Date().toISOString()
    };
    state.encounters.unshift(record);
    persistLocal();
    return record;
  }

  function removeEncounter(encounterId) {
    state.encounters = state.encounters.filter((e) => e.id !== encounterId);
    persistLocal();
  }

  function importBundle(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Formato de archivo o enlace inválido.');
    }
    let importedProfiles = 0;
    let importedEncounters = 0;

    const listProfiles = Array.isArray(payload)
      ? payload
      : payload.type === 'profile' && payload.profile
        ? [payload.profile]
        : Array.isArray(payload.profiles)
          ? payload.profiles
          : payload.nombre && payload.correo
            ? [payload]
            : [];

    for (const item of listProfiles) {
      mergeProfile(item.profile || item, false);
      importedProfiles += 1;
    }

    const listEncounters = Array.isArray(payload.encounters) ? payload.encounters : [];
    for (const enc of listEncounters) {
      if (enc?.participanteA && enc?.participanteB && !state.encounters.some((e) => e.id === enc.id)) {
        state.encounters.push({ ...enc, id: enc.id || createId('enc') });
        importedEncounters += 1;
      }
    }

    persistLocal();
    return { importedProfiles, importedEncounters };
  }

  function clearAll() {
    state = structuredClone(EMPTY_STATE);
    persistLocal();
  }

  function toggleSavedProfile(profileId) {
    if (!profileId) return false;
    const list = Array.isArray(state.savedIds) ? state.savedIds : [];
    const exists = list.includes(profileId);
    state.savedIds = exists ? list.filter((id) => id !== profileId) : [...list, profileId];
    persistLocal();
    return !exists;
  }

  return {
    getState,
    subscribe,
    getMyProfile,
    syncFromSources,
    saveMyInterview,
    removeProfile,
    addEncounter,
    removeEncounter,
    importBundle,
    toggleSavedProfile,
    clearAll
  };
}
