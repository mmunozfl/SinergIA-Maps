/**
 * Normaliza texto para comparaciones insensibles a mayúsculas, tildes y espacios.
 */
export function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Detecta coincidencias entre conjuntos de tags o texto libre.
 */
function intersectTags(tagsA = [], tagsB = []) {
  const mapB = new Map(tagsB.map((t) => [normalizeText(t), t]));
  const matches = [];
  for (const tag of tagsA) {
    const key = normalizeText(tag);
    if (mapB.has(key)) matches.push(tag);
  }
  return matches;
}

/**
 * Analiza un par de funcionarios y determina sus puentes de sinergia reales.
 */
export function analyzePairSynergy(a, b) {
  const sameArea = normalizeText(a.area) === normalizeText(b.area);
  const sameMacro = a.macroId === b.macroId;
  const aHelpsB = intersectTags(a.temasAyudo, b.temasBusco);
  const bHelpsA = intersectTags(b.temasAyudo, a.temasBusco);
  const sharedHuman = intersectTags(a.interesesComunes, b.interesesComunes);
  const sharedWork = intersectTags(a.temasAyudo, b.temasAyudo);

  const reasons = [];
  let score = 0;

  if (!sameArea) {
    score += 4;
    reasons.push(!sameMacro ? 'Cruza distintas Vicerrectorías' : 'Cruza distintas Unidades');
  }
  if (aHelpsB.length) {
    score += aHelpsB.length * 6;
    reasons.push(`${a.nombre.split(' ')[0]} puede apoyar en: ${aHelpsB.join(', ')}`);
  }
  if (bHelpsA.length) {
    score += bHelpsA.length * 6;
    reasons.push(`${b.nombre.split(' ')[0]} puede apoyar en: ${bHelpsA.join(', ')}`);
  }
  if (sharedHuman.length) {
    score += sharedHuman.length * 3;
    reasons.push(`Afinidad humana: ${sharedHuman.join(', ')}`);
  }
  if (sharedWork.length && !sameArea) {
    score += sharedWork.length * 2;
    reasons.push(`Tema común entre áreas: ${sharedWork.join(', ')}`);
  }

  let kind = 'afinidades';
  if (aHelpsB.length || bHelpsA.length) kind = 'ayuda_mutua';
  else if (!sameMacro && sharedWork.length) kind = 'saber_compartido';

  return {
    sourceId: a.id,
    targetId: b.id,
    crossArea: !sameArea,
    crossMacro: !sameMacro,
    score,
    kind,
    aHelpsB,
    bHelpsA,
    sharedHuman,
    sharedWork,
    reasons
  };
}

/**
 * Construye el grafo analítico completo para el visor interactivo y estadísticas reales.
 */
export function buildSynergyNetwork(profiles) {
  const edges = [];
  const tagCounts = new Map();

  for (const p of profiles) {
    for (const tag of [...(p.temasAyudo || []), ...(p.interesesComunes || [])]) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const link = analyzePairSynergy(profiles[i], profiles[j]);
      if (link.aHelpsB.length || link.bHelpsA.length || link.sharedHuman.length || (link.crossArea && link.sharedWork.length)) {
        edges.push(link);
      }
    }
  }

  edges.sort((x, y) => y.score - x.score);

  const crossMacroCount = edges.filter((e) => e.crossMacro).length;
  const topTopics = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic, count]) => ({ topic, count }));

  return {
    nodes: profiles,
    edges,
    insights: {
      totalEdges: edges.length,
      crossMacroEdges: crossMacroCount,
      helpMatches: edges.filter((e) => e.kind === 'ayuda_mutua').length,
      topTopics
    }
  };
}

/**
 * Filtra perfiles por término de búsqueda libre, macro-estructura o conducta clave.
 */
export function filterProfiles(profiles, { query = '', macroId = '', conductaId = '', onlyOtherAreas = false, myProfile = null } = {}) {
  const q = normalizeText(query);
  const myArea = myProfile ? normalizeText(myProfile.area) : '';

  return profiles.filter((p) => {
    if (onlyOtherAreas && myProfile && (p.id === myProfile.id || normalizeText(p.area) === myArea)) {
      return false;
    }
    if (macroId && p.macroId !== macroId) return false;
    if (conductaId && p.conductaFortaleza !== conductaId) return false;
    if (!q) return true;

    const text = [
      p.nombre,
      p.area,
      p.macroNombre,
      p.cargo,
      p.queHace,
      p.detalleAyudo,
      p.detalleBusco,
      p.datoOnboarding,
      ...(p.temasAyudo || []),
      ...(p.temasBusco || []),
      ...(p.interesesComunes || [])
    ].join(' ');
    return normalizeText(text).includes(q);
  });
}

/**
 * Sugiere los mejores pares para un funcionario dado.
 */
export function suggestMatches(myProfile, allProfiles) {
  if (!myProfile) return [];
  return allProfiles
    .filter((p) => p.id !== myProfile.id)
    .map((other) => ({
      profile: other,
      analysis: analyzePairSynergy(myProfile, other)
    }))
    .sort((a, b) => b.analysis.score - a.analysis.score);
}

/**
 * Calcula métricas reales a partir del estado guardado.
 */
export function computeMetrics(state, network) {
  const areas = new Set(state.profiles.map((p) => normalizeText(p.area)).filter(Boolean));
  const macros = new Set(state.profiles.map((p) => p.macroId).filter(Boolean));
  const timed = state.profiles
    .map((p) => Number(p.duracionSegundos))
    .filter((sec) => Number.isFinite(sec) && sec > 0);
  const avgDurationSeconds = timed.length
    ? Math.round(timed.reduce((acc, v) => acc + v, 0) / timed.length)
    : null;

  const connections = Array.isArray(state.connections) ? state.connections : [];
  const connectedPeople = new Set(
    connections
      .filter((c) => c && c.fromKey && c.toId && c.fromKey !== c.toId)
      .map((c) => c.fromKey)
  );

  return {
    totalProfiles: state.profiles.length,
    totalAreas: areas.size,
    totalMacros: macros.size,
    totalConnections: network.insights.totalEdges,
    crossMacroEdges: network.insights.crossMacroEdges,
    totalEncounters: state.encounters.length,
    connectedPeopleCount: connectedPeople.size,
    avgDurationSeconds
  };
}

/**
 * Recolecta etiquetas personalizadas creadas por otros participantes para sugerirlas dinámicamente (SSOT + comunidad).
 */
export function collectCommunityTags(profiles, sourceKey, baseTags = []) {
  const seen = new Set(baseTags.map((t) => normalizeText(t)));
  const fieldKeys =
    sourceKey === 'interesesHumanos'
      ? ['interesesComunes']
      : sourceKey === 'temasTrabajo'
        ? ['temasAyudo', 'temasBusco']
        : [];

  const extras = [];
  for (const profile of profiles || []) {
    for (const key of fieldKeys) {
      for (const raw of profile[key] || []) {
        const clean = String(raw || '').trim();
        const norm = normalizeText(clean);
        if (clean && norm && !seen.has(norm)) {
          seen.add(norm);
          extras.push(clean);
        }
      }
    }
  }
  return extras.sort((a, b) => a.localeCompare(b, 'es'));
}
