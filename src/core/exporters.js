import { encodePayload } from './store.js';

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Construye enlace directo para iniciar chat en Microsoft Teams.
 */
export function buildTeamsChatUrl(targetProfile, myProfile) {
  const intro = myProfile
    ? `Hola ${targetProfile.nombre}, soy ${myProfile.nombre} (${myProfile.area}). Vi tu entrevista en SinergIA-Maps, ¿conversamos 15 min?`
    : `Hola ${targetProfile.nombre}, vi tu perfil en SinergIA-Maps. ¿Coordinamos 15 min para conocernos entre áreas?`;

  const params = new URLSearchParams({
    users: targetProfile.correo,
    message: intro
  });
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}

/**
 * Construye enlace directo para crear reunión en Microsoft Teams (envía correo oficial con Aceptar/Rechazar).
 */
export function buildTeamsMeetingUrl({ targetProfile, myProfile, startDateTimeLocal, durationMinutes = 15 }) {
  const start = startDateTimeLocal ? new Date(startDateTimeLocal) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Fecha u hora de reunión inválida.');
  }
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const organizer = myProfile ? `${myProfile.nombre} (${myProfile.area})` : 'Colega';
  const subject = `SinergIA-Maps: ${organizer} ↔ ${targetProfile.nombre}`;
  const content = [
    `Micro-encuentro SinergIA-Maps (${durationMinutes} min) para conocernos y compartir apoyo entre áreas.`,
    targetProfile.detalleAyudo ? `Puede orientar en: ${targetProfile.detalleAyudo}` : '',
    targetProfile.interesesComunes?.length
      ? `Intereses para romper el hielo: ${targetProfile.interesesComunes.join(', ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  const toIsoUtc = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const query = [
    `subject=${encodeURIComponent(subject)}`,
    `attendees=${encodeURIComponent(targetProfile.correo)}`,
    `startTime=${encodeURIComponent(toIsoUtc(start))}`,
    `endTime=${encodeURIComponent(toIsoUtc(end))}`,
    `content=${encodeURIComponent(content)}`
  ].join('&');

  return `https://teams.microsoft.com/l/meeting/new?${query}`;
}

/**
 * Genera el contenido descargable de calendario (.ics) para Teams / Outlook.
 */
export function buildIcsInvite({ targetProfile, myProfile, startDateTimeLocal, durationMinutes = 15 }) {
  const start = startDateTimeLocal ? new Date(startDateTimeLocal) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Fecha u hora de reunión inválida.');
  }
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const organizer = myProfile ? `${myProfile.nombre} (${myProfile.area})` : 'Participante SinergIA-Maps';
  const summary = `SinergIA-Maps: ${organizer} ↔ ${targetProfile.nombre} (${targetProfile.area})`;
  const description = [
    'Micro-encuentro de Sinergia Organizacional (SinergIA-Maps).',
    `Propósito: Conocernos y compartir recursos entre unidades (${durationMinutes} min).`,
    targetProfile.detalleAyudo ? `\nPuede orientar en: ${targetProfile.detalleAyudo}` : '',
    targetProfile.datoOnboarding ? `\nDato práctico compartido: ${targetProfile.datoOnboarding}` : ''
  ].join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SinergIA-Maps//Networking Interareas//ES',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sinergia-maps`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText('Microsoft Teams')}`,
    myProfile?.correo ? `ORGANIZER:mailto:${myProfile.correo}` : '',
    `ATTENDEE;RSVP=TRUE:mailto:${targetProfile.correo}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Construye una URL compartible con una ficha codificada en el hash.
 */
export function buildShareUrl(profile) {
  const token = encodePayload({ type: 'profile', profile });
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#import=${token}`;
}

/**
 * Busca etiqueta legible en catálogos del modelo SSOT.
 */
export function findModelLabel(modelo, sourceKey, itemId, fallback = '-') {
  const list = modelo[sourceKey];
  if (!Array.isArray(list)) return fallback;
  const found = list.find((item) => item.id === itemId);
  if (!found) return fallback;
  return found.numero ? `Conducta ${found.numero}: ${found.titulo}` : (found.nombre || found.titulo || fallback);
}

/**
 * Genera acta en Markdown estructurado lista para respaldar en BUK.
 */
export function buildEvidenceMarkdown(encounter, modelo) {
  return [
    `# Evidencia Sinergia Organizacional — ${modelo.programa.institucion}`,
    `- **Fecha:** ${encounter.fecha}`,
    `- **Participantes:** ${encounter.participanteA} ↔ ${encounter.participanteB}`,
    `- **Acción realizada:** ${findModelLabel(modelo, 'tiposAccion', encounter.tipoAccion)}`,
    `- **Conducta clave fortalecida:** ${findModelLabel(modelo, 'conductas', encounter.conductaId)}`,
    `- **Etapa observada (Susan Long):** ${findModelLabel(modelo, 'etapas', encounter.etapaId)}`,
    `- **Aprendizaje interáreas:** ${encounter.aprendizaje}`,
    `- **Acuerdo / Apoyo concreto:** ${encounter.acuerdo}`,
    `- **Responsable registro BUK:** ${encounter.responsableRegistro}`
  ].join('\n');
}

/**
 * Descarga cualquier contenido de texto (JSON, ICS, SVG).
 */
export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Exporta un nodo SVG del mapa como archivo .svg listo para adjuntar en BUK o presentaciones.
 */
export function exportSvgNode(svgElement, filename = 'mapa-sinergia-maps.svg') {
  if (!svgElement) return;
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = (clone.getAttribute('viewBox') || '').trim().split(/\s+/);
  if (vb.length === 4) {
    if (!clone.getAttribute('width')) clone.setAttribute('width', vb[2]);
    if (!clone.getAttribute('height')) clone.setAttribute('height', vb[3]);
  }
  const serializer = new XMLSerializer();
  downloadTextFile(filename, serializer.serializeToString(clone), 'image/svg+xml;charset=utf-8');
}
