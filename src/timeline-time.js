// Minute-resolution wall times with explicit zones; never parse human text with Date.
export const pad = value => String(value).padStart(2, '0');
export const zoneNow = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const formatters = new Map();
function formatter(zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(zone);
}
export function zonedParts(value, zone = zoneNow()) {
  return Object.fromEntries(formatter(zone).formatToParts(new Date(value)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function dateInZone(value = Date.now(), zone = zoneNow()) {
  const p = zonedParts(value, zone); return `${p.year}-${p.month}-${p.day}`;
}
export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const n = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === date;
}
export function shiftDate(date, days) {
  if (!validDate(date)) throw new Error('Choose a valid date.');
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export const dayDifference = (start, end) => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
export function isoAt(value = Date.now(), zone = zoneNow()) {
  const ms = Math.floor(Number(new Date(value)) / 60000) * 60000;
  const p = zonedParts(ms, zone);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const offset = Math.round((wall - ms) / 60000);
  const sign = offset < 0 ? '-' : '+';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
export const minutesOf = iso => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
export function formatClock(value) {
  const minutes = typeof value === 'number' ? value : minutesOf(value);
  const h = Math.floor(minutes / 60);
  return `${pad(h % 12 || 12)}:${pad(minutes % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}
export function parseClock(text, period = '') {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(text).trim());
  if (!match) throw new Error('Use a time such as 8:10 AM.');
  const hour = Number(match[1]), minute = Number(match[2] || 0), meridiem = (match[3] || period).toUpperCase();
  if (minute > 59) throw new Error('Minutes must be between 00 and 59.');
  if (meridiem) {
    if (!['AM', 'PM'].includes(meridiem) || hour < 1 || hour > 12) throw new Error('AM/PM hours must be between 1 and 12.');
    return hour % 12 * 60 + minute + (meridiem === 'PM' ? 720 : 0);
  }
  if (hour > 23) throw new Error('Hours must be between 00 and 23.');
  if (hour > 0 && hour <= 12) throw new Error('Choose AM or PM, for example 8:10 AM.');
  return hour * 60 + minute;
}
const token = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)';
const rangeRE = new RegExp(`^${token}\\s*[-–~]\\s*${token}(?=\\s|$)\\s*(.*)$`, 'i');
const singleRE = new RegExp(`^${token}(?=\\s|$)\\s*(.*)$`, 'i');
export function parseQuick(text) {
  const raw = String(text).trim();
  if (!raw) throw new Error('Enter an activity or a time.');
  if (/[\r\n]/.test(raw)) throw new Error('Add one activity at a time.');
  let m = rangeRE.exec(raw);
  if (m) return { startMinutes: parseClock(m[1]), endMinutes: parseClock(m[2]), title: m[3].trim() };
  m = singleRE.exec(raw);
  if (m) {
    if (/^[-–~]/.test(m[2]) || /^\d{1,2}(?::\d|\s*(?:am|pm))/i.test(m[2])) throw new Error('Complete the end time and separate the times with - .');
    return { startMinutes: parseClock(m[1]), endMinutes: null, title: m[2].trim() };
  }
  if (/^\d{1,2}(?::|\s*(?:am|pm)\b)/i.test(raw)) throw new Error('Check the time. Use 8:10 AM or 8:10 AM - 8:40 AM.');
  return { startMinutes: null, endMinutes: null, title: raw };
}
// Enumerate nearby offsets so gaps and repeated local hours are explicit.
export function wallCandidates(date, minutes, zone) {
  if (!validDate(date) || !Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new Error('Choose a valid date and time.');
  const wall = Date.parse(`${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00Z`);
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(isoAt(wall + hours * 3600000, zone).slice(-6));
  return [...offsets].map(offset => `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${offset}`)
    .filter(iso => isoAt(Date.parse(iso), zone) === iso).sort((a, b) => Date.parse(a) - Date.parse(b));
}
export function wallToIso(date, minutes, zone, offset = '') {
  const options = wallCandidates(date, minutes, zone);
  if (!options.length) throw new Error('This time does not exist because of a daylight-saving change. Choose another time.');
  if (options.length === 1) return options[0];
  const chosen = options.find(iso => iso.endsWith(offset) && offset);
  if (chosen) return chosen;
  const error = new Error('This time occurs twice. Choose a UTC offset.');
  error.options = options; throw error;
}
export function validZonedIso(iso, zone) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test(iso) || !validDate(iso.slice(0, 10))) return false;
  try { return isoAt(Date.parse(iso), zone) === iso; } catch { return false; }
}
export function simpleDay(date, records) {
  const zones = new Set(records.map(r => r.timeZone));
  if (zones.size > 1) return false;
  const zone = [...zones][0] || zoneNow();
  try {
    const a = wallCandidates(date, 0, zone)[0], b = wallCandidates(shiftDate(date, 1), 0, zone)[0];
    return Boolean(a && b && Date.parse(b) - Date.parse(a) === 86400000);
  } catch { return false; }
}
