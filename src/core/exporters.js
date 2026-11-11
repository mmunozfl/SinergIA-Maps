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
    ? `Hola ${targetProfile.nombre}, soy ${myProfile.nombre} (${myProfile.area}). Vi tu entrevista en SinergIA UCM, ¿conversamos 15 min?`
    : `Hola ${targetProfile.nombre}, vi tu perfil en SinergIA UCM. ¿Coordinamos 15 min para conocernos entre áreas?`;

  const params = new URLSearchParams({
    users: targetProfile.correo,
    message: intro
  });
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
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

  const organizer = myProfile ? `${myProfile.nombre} (${myProfile.area})` : 'Participante SinergIA UCM';
  const summary = `SinergIA UCM: ${organizer} ↔ ${targetProfile.nombre} (${targetProfile.area})`;
  const description = [
    'Micro-encuentro de Sinergia Organizacional (Programa Nuestro Sello - UCM).',
    `Propósito: Conocernos y compartir recursos entre unidades (${durationMinutes} min).`,
    targetProfile.detalleAyudo ? `\nPuede orientar en: ${targetProfile.detalleAyudo}` : '',
    targetProfile.datoOnboarding ? `\nDato UCM compartido: ${targetProfile.datoOnboarding}` : ''
  ].join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SinergIA UCM//Networking Interareas//ES',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sinergia-ucm`,
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
export function exportSvgNode(svgElement, filename = 'mapa-sinergia-ucm.svg') {
  if (!svgElement) return;
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  downloadTextFile(filename, serializer.serializeToString(clone), 'image/svg+xml;charset=utf-8');
}
