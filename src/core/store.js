import {
  loadAuthSession,
  saveAuthSession,
  getValidSession,
  signOutAuth,
  getAuthUserFromSession
} from './auth.js';

const STORAGE_KEY = 'sinergia_maps_state_v2';
const LEGACY_STORAGE_KEY = 'sinergia_ucm_state_v2';
const PENDING_ACTION_KEY = 'sinergia_maps_pending_action_v1';
const CLIENT_ID_KEY = 'sinergia_maps_client_id_v1';

const EMPTY_STATE = {
  myProfileId: null,
  profiles: [],
  encounters: [],
  connections: [],
  savedIds: [],
  authUser: null,
  syncStatus: 'local'
};

function getOrCreateClientId() {
  if (typeof localStorage === 'undefined') return 'anon_session';
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = `anon_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return 'anon_session';
  }
}

export function savePendingAction(action) {
  if (typeof localStorage === 'undefined') return;
  if (!action) {
    localStorage.removeItem(PENDING_ACTION_KEY);
    return;
  }
  localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({ ...action, createdAt: Date.now() }));
}

export function consumePendingAction() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_ACTION_KEY);
    localStorage.removeItem(PENDING_ACTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.createdAt && Date.now() - parsed.createdAt > 30 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

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
 * Resuelve el bloque macro desde el catálogo de organigrama configurado en el modelo SSOT.
 */
export function resolveMacroUnidad(modelo, areaName) {
  const target = String(areaName || '').trim().toLowerCase();
  for (const grupo of modelo.organigramaUCM || []) {
    if (grupo.unidades.some((u) => u.toLowerCase() === target)) {
      return { macroId: grupo.macroId, macroNombre: grupo.macroNombre };
    }
  }
  return { macroId: 'otra', macroNombre: 'Otra Unidad / Área' };
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

function buildSupabaseHeaders(anonKey, extra = {}, accessToken = null) {
  const headers = { apikey: anonKey, ...extra };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (String(anonKey).startsWith('eyJ')) {
    headers.Authorization = `Bearer ${anonKey}`;
  }
  return headers;
}

function makeRemoteError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseSupabaseError(status, bodyText, fallback) {
  const text = String(bodyText || '');
  const lower = text.toLowerCase();
  if (status === 409 || lower.includes('23505') || lower.includes('duplicate key')) {
    return makeRemoteError('DUPLICATE_EMAIL', 'Ya existe una ficha registrada con ese correo.');
  }
  if (lower.includes('42501') || lower.includes('row-level security')) {
    return makeRemoteError(
      'RLS_POLICY_REQUIRED',
      'Falta actualizar las políticas de seguridad (SQL) en Supabase para editar o eliminar fichas verificadas.'
    );
  }
  if (status === 401) {
    return makeRemoteError('AUTH_REQUIRED', 'Tu verificación venció. Confirma nuevamente tu correo para continuar.');
  }
  if (status === 403) {
    return makeRemoteError(
      'RLS_POLICY_REQUIRED',
      'Supabase rechazó la operación por permisos RLS. Revisa las políticas en SQL Editor.'
    );
  }
  return new Error(`${fallback} (${status})`);
}

/**
 * Contenedor único de estado (SSOT en tiempo de ejecución) con soporte híbrido:
 * lectura desde repo JSON + persistencia local + adaptador opcional webhook/Supabase.
 */
export function createStore(modelo) {
  let state = loadLocalState();
  let connectionsTableMissing = false;
  const listeners = new Set();
  reconcileMyProfile();

  function loadLocalState() {
    const authUser = getAuthUserFromSession(loadAuthSession());
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return { ...structuredClone(EMPTY_STATE), authUser };
      const parsed = JSON.parse(raw);
      return {
        myProfileId: typeof parsed.myProfileId === 'string' ? parsed.myProfileId : null,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        encounters: Array.isArray(parsed.encounters) ? parsed.encounters : [],
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        savedIds: Array.isArray(parsed.savedIds) ? parsed.savedIds : [],
        authUser,
        syncStatus: 'local'
      };
    } catch {
      return { ...structuredClone(EMPTY_STATE), authUser };
    }
  }

  function reconcileMyProfile() {
    if (state.authUser?.email) {
      const matched = state.profiles.find((p) => p.correo === state.authUser.email);
      state.myProfileId = matched ? matched.id : null;
      return;
    }
    if (state.myProfileId && state.profiles.length && !state.profiles.some((p) => p.id === state.myProfileId)) {
      state.myProfileId = null;
    }
  }

  function persistLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      myProfileId: state.myProfileId,
      profiles: state.profiles,
      encounters: state.encounters,
      connections: state.connections,
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
    if (state.authUser?.email) {
      const byEmail = state.profiles.find((p) => p.correo === state.authUser.email);
      if (byEmail) return byEmail;
    }
    return state.profiles.find((p) => p.id === state.myProfileId) || null;
  }

  function isProfileMine(profile) {
    if (!profile) return false;
    if (state.authUser?.email && profile.correo === state.authUser.email) return true;
    return Boolean(state.myProfileId && profile.id === state.myProfileId);
  }

  function isProfileVerifiedOwner(profile) {
    return Boolean(profile && state.authUser?.email && profile.correo === state.authUser.email);
  }

  function setAuthSession(session, { clearLocalIdentity = false } = {}) {
    saveAuthSession(session);
    state.authUser = getAuthUserFromSession(session);
    if (!session && clearLocalIdentity) {
      state.myProfileId = null;
    } else if (session) {
      reconcileMyProfile();
    }
    persistLocal();
  }

  async function signOut() {
    await signOutAuth(modelo.storageConfig || {});
    setAuthSession(null, { clearLocalIdentity: true });
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

  async function supabaseInsertProfile(cfg, table, profile, accessToken = null) {
    const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildSupabaseHeaders(
        cfg.supabaseAnonKey,
        { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        accessToken
      ),
      body: JSON.stringify({ id: profile.id, correo: profile.correo, payload: profile, updated_at: profile.updatedAt })
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw parseSupabaseError(res.status, bodyText, 'Error Supabase al crear ficha');
    }
    return 'supabase';
  }

  async function supabaseUpdateProfile(cfg, table, profile, session) {
    const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?correo=eq.${encodeURIComponent(profile.correo)}`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: buildSupabaseHeaders(
        cfg.supabaseAnonKey,
        { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        session.accessToken
      ),
      body: JSON.stringify({ id: profile.id, correo: profile.correo, payload: profile, updated_at: profile.updatedAt })
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      if (res.status === 401) {
        saveAuthSession(null);
        state.authUser = null;
        persistLocal();
      }
      throw parseSupabaseError(res.status, bodyText, 'Error Supabase al actualizar ficha');
    }
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) {
      return supabaseInsertProfile(cfg, table, profile, session.accessToken);
    }
    return 'supabase';
  }

  async function pushToRemote(profile, { isUpdate = false } = {}) {
    const cfg = modelo.storageConfig || {};

    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      const table = cfg.supabaseTable || 'cuestionarios_sinergia';
      const session = await getValidSession(cfg);
      state.authUser = getAuthUserFromSession(session);
      const sessionMatchesEmail = Boolean(session?.user?.email && session.user.email === profile.correo);
      const alreadyExists = state.profiles.some((p) => p.correo === profile.correo);

      if (isUpdate) {
        if (!sessionMatchesEmail) {
          throw makeRemoteError('AUTH_REQUIRED', 'Verifica tu correo institucional para guardar cambios en tu ficha.');
        }
        return supabaseUpdateProfile(cfg, table, profile, session);
      }

      if (alreadyExists) {
        if (!sessionMatchesEmail) {
          throw makeRemoteError('DUPLICATE_EMAIL', 'Ya existe una ficha registrada con ese correo.');
        }
        return supabaseUpdateProfile(cfg, table, profile, session);
      }

      return supabaseInsertProfile(cfg, table, profile, sessionMatchesEmail ? session.accessToken : null);
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
    const prevMyId = state.myProfileId;
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
          reconcileMyProfile();
          const wasLocal = state.syncStatus !== 'supabase';
          state.syncStatus = 'supabase';
          changed = wasLocal || state.myProfileId !== prevMyId || JSON.stringify(state.profiles) !== prevSnapshot;
        }
        if (!connectionsTableMissing) {
          const connTable = cfg.supabaseConnectionsTable || 'conexiones_sinergia';
          const connEndpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${connTable}?select=id,from_key,to_id,channel,created_at`;
          const connRes = await fetch(connEndpoint, {
            headers: buildSupabaseHeaders(cfg.supabaseAnonKey)
          });
          if (connRes.status === 404) {
            connectionsTableMissing = true;
          } else if (connRes.ok) {
            const connRows = await connRes.json();
            const remoteMap = new Map();
            for (const row of Array.isArray(connRows) ? connRows : []) {
              if (!row?.from_key || !row?.to_id) continue;
              const id = row.id || `${row.from_key}__${row.to_id}`;
              remoteMap.set(id, {
                id,
                fromKey: row.from_key,
                toId: row.to_id,
                channel: row.channel || 'teams_chat',
                createdAt: row.created_at || new Date().toISOString()
              });
            }

            // Subir a Supabase conexiones locales que aún no estén en la nube
            const localList = Array.isArray(state.connections) ? state.connections : [];
            for (const localConn of localList) {
              if (!remoteMap.has(localConn.id)) {
                fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${connTable}`, {
                  method: 'POST',
                  headers: buildSupabaseHeaders(cfg.supabaseAnonKey, {
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=ignore-duplicates, return=minimal'
                  }),
                  body: JSON.stringify({
                    id: localConn.id,
                    from_key: localConn.fromKey,
                    to_id: localConn.toId,
                    channel: localConn.channel,
                    created_at: localConn.createdAt
                  })
                }).catch(() => {});
                remoteMap.set(localConn.id, localConn);
              }
            }

            const nextConnections = [...remoteMap.values()];
            if (JSON.stringify(nextConnections) !== JSON.stringify(state.connections)) {
              state.connections = nextConnections;
              changed = true;
            }
          }
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

  async function saveMyInterview(values, { markAsMine = true, isEditing = false } = {}) {
    const clean = sanitizeProfile(values, modelo);
    const cfg = modelo.storageConfig || {};
    const hasSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

    if (hasSupabase) {
      try {
        const remoteMode = await pushToRemote(clean, { isUpdate: isEditing });
        const saved = mergeProfile(clean, markAsMine);
        persistLocal();
        return { profile: saved, remoteMode, remoteError: null, remoteErrorCode: null };
      } catch (err) {
        if (['AUTH_REQUIRED', 'DUPLICATE_EMAIL', 'RLS_POLICY_REQUIRED'].includes(err.code)) {
          return {
            profile: clean,
            remoteMode: 'blocked',
            remoteError: err.message,
            remoteErrorCode: err.code
          };
        }
        const saved = mergeProfile(clean, markAsMine);
        persistLocal();
        return { profile: saved, remoteMode: 'local', remoteError: err.message, remoteErrorCode: 'NETWORK' };
      }
    }

    const saved = mergeProfile(clean, markAsMine);
    persistLocal();
    let remoteMode = 'local';
    let remoteError = null;
    try {
      remoteMode = await pushToRemote(saved, { isUpdate: isEditing });
    } catch (err) {
      remoteError = err.message;
    }
    return { profile: saved, remoteMode, remoteError, remoteErrorCode: null };
  }

  function removeProfile(profileId) {
    state.profiles = state.profiles.filter((p) => p.id !== profileId);
    state.savedIds = (state.savedIds || []).filter((id) => id !== profileId);
    if (state.myProfileId === profileId) state.myProfileId = null;
    persistLocal();
  }

  async function deleteMyProfile(profileId) {
    const target = state.profiles.find((p) => p.id === profileId);
    if (!target) return { deleted: false };

    const cfg = modelo.storageConfig || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      const table = cfg.supabaseTable || 'cuestionarios_sinergia';
      const session = await getValidSession(cfg);
      state.authUser = getAuthUserFromSession(session);
      if (!session?.user?.email || session.user.email !== target.correo) {
        throw makeRemoteError('AUTH_REQUIRED', 'Verifica tu correo institucional para eliminar tu ficha del mapa.');
      }

      const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?correo=eq.${encodeURIComponent(target.correo)}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: buildSupabaseHeaders(cfg.supabaseAnonKey, { Prefer: 'return=representation' }, session.accessToken)
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        if (res.status === 401) {
          saveAuthSession(null);
          state.authUser = null;
          persistLocal();
        }
        throw parseSupabaseError(res.status, bodyText, 'No se pudo eliminar la ficha de Supabase');
      }
      const deletedRows = await res.json().catch(() => []);
      if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
        throw makeRemoteError(
          'RLS_POLICY_REQUIRED',
          'Falta habilitar la política DELETE en Supabase (SQL Editor) para borrar tu ficha.'
        );
      }
    }

    removeProfile(target.id);
    return { deleted: true, profile: target };
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

  async function recordTeamsConnection(targetProfile, channel = 'teams_chat') {
    if (!targetProfile?.id) return null;
    const fromKey = getMyProfile()?.id || getOrCreateClientId();
    if (targetProfile.id === fromKey) return null;

    const id = `${fromKey}__${targetProfile.id}`;
    const list = Array.isArray(state.connections) ? state.connections : [];
    const existing = list.find((c) => c.id === id);
    if (existing) return existing;

    const entry = {
      id,
      fromKey,
      toId: targetProfile.id,
      channel,
      createdAt: new Date().toISOString()
    };

    state.connections = [entry, ...list];
    persistLocal();

    const cfg = modelo.storageConfig || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey && !connectionsTableMissing) {
      const connTable = cfg.supabaseConnectionsTable || 'conexiones_sinergia';
      const endpoint = `${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/${connTable}`;
      fetch(endpoint, {
        method: 'POST',
        headers: buildSupabaseHeaders(cfg.supabaseAnonKey, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates, return=minimal'
        }),
        body: JSON.stringify({
          id: entry.id,
          from_key: entry.fromKey,
          to_id: entry.toId,
          channel: entry.channel,
          created_at: entry.createdAt
        })
      })
        .then((res) => {
          if (res.status === 404) connectionsTableMissing = true;
        })
        .catch(() => {});
    }

    return entry;
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
    isProfileMine,
    isProfileVerifiedOwner,
    setAuthSession,
    signOut,
    syncFromSources,
    saveMyInterview,
    removeProfile,
    deleteMyProfile,
    addEncounter,
    removeEncounter,
    recordTeamsConnection,
    importBundle,
    toggleSavedProfile,
    clearAll
  };
}
