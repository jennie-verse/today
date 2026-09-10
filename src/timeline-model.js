import { validDate, validZonedIso, dateInZone, zoneNow, isoAt } from './timeline-time.js';
export const newId = () => crypto.randomUUID();
const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const stampOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
export function validateEntry(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || !idOK(r.id) || !idOK(r.revisionId)) throw new Error('Invalid timeline identity.');
  if (r.baseRevisionId !== null && !idOK(r.baseRevisionId)) throw new Error('Invalid timeline revision.');
  if (!Array.isArray(r.supersedes) || r.supersedes.some(id => !idOK(id)) || r.supersedes.includes(r.revisionId)) throw new Error('Invalid timeline history.');
  if (typeof r.title !== 'string' || /[\r\n]/.test(r.title) || [...r.title].length > 140) throw new Error('Activity must be one line, up to 140 characters.');
  if (typeof r.timeZone !== 'string' || !validZonedIso(r.startedAt, r.timeZone) || (r.endedAt !== null && !validZonedIso(r.endedAt, r.timeZone))) throw new Error('Invalid timeline date or time zone.');
  if (r.startDate !== r.startedAt.slice(0, 10) || r.endDate !== (r.endedAt?.slice(0, 10) || null)) throw new Error('Timeline dates do not match the times.');
  if (r.endedAt && Date.parse(r.endedAt) < Date.parse(r.startedAt)) throw new Error('End must be at or after start. Choose Next day if needed.');
  if (typeof r.isRunning !== 'boolean' || (r.isRunning && (r.endedAt || r.deletedAt))) throw new Error('A finished or deleted activity cannot be current.');
  if (!stampOK(r.createdAt) || !stampOK(r.updatedAt) || (r.deletedAt !== null && !stampOK(r.deletedAt))) throw new Error('Invalid timeline timestamp.');
  if (!validDate(`${r.bucket}-01`)) throw new Error('Invalid timeline month.');
  return r;
}
export function reviseEntry(draft, previous = null, { now = Date.now(), known = [], allowFuture = false } = {}) {
  const zone = draft.timeZone || previous?.timeZone || zoneNow();
  const startedAt = draft.startedAt ?? previous?.startedAt ?? isoAt(now, zone);
  const endedAt = draft.endedAt === undefined ? previous?.endedAt || null : draft.endedAt;
  const latest = Math.max(now, ...[previous, ...known].filter(Boolean).map(r => Date.parse(r.updatedAt) + 1));
  const updatedAt = new Date(latest).toISOString();
  const result = {
    id: previous?.id || draft.id || newId(), title: String(draft.title ?? previous?.title ?? '').trim(),
    startedAt, endedAt, timeZone: zone, isRunning: Boolean(draft.isRunning ?? previous?.isRunning ?? false),
    startDate: startedAt.slice(0, 10), endDate: endedAt?.slice(0, 10) || null,
    bucket: previous?.bucket || dateInZone(now, zone).slice(0, 7),
    createdAt: previous?.createdAt || new Date(now).toISOString(), updatedAt,
    revisionId: newId(), baseRevisionId: previous?.revisionId || null,
    supersedes: [...new Set([previous, ...known].filter(Boolean).flatMap(r => [r.revisionId, ...(r.supersedes || [])]))].sort(),
    deletedAt: draft.deletedAt ? updatedAt : null,
  };
  if (result.endedAt || result.deletedAt) result.isRunning = false;
  validateEntry(result);
  // A timeline time may be earlier or later than the current moment — the
  // user records and edits activities freely in either direction.
  return result;
}
export const compareRevision = (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.revisionId.localeCompare(b.revisionId);
// Plan §8: displayed start time first, then the absolute instant (so a
// DST fall-back repeated hour still orders CDT before CST at the same
// wall-clock minute), then createdAt, then id.
export const sortEntries = entries => [...entries].sort((a, b) =>
  a.startedAt.slice(11, 16).localeCompare(b.startedAt.slice(11, 16))
  || Date.parse(a.startedAt) - Date.parse(b.startedAt)
  || a.createdAt.localeCompare(b.createdAt)
  || a.id.localeCompare(b.id));
export function dayEntries(entries, date) {
  return sortEntries(entries.filter(r => !r.deletedAt && r.startDate === date));
}
// A conflict is a live concurrent head. All heads travel with the sync payload.
export function mergeEntries(...collections) {
  const canonical = r => JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(key => [key, key === 'supersedes' ? [...r[key]].sort() : r[key]])));
  const all = new Map();
  for (const r of collections.flat()) {
    validateEntry(r);
    const key = `${r.id}:${r.revisionId}`, old = all.get(key);
    if (old && canonical(old) !== canonical(r)) throw new Error('Two different records have the same revision. Sync was not applied.');
    all.set(key, r);
  }
  const groups = new Map();
  for (const r of all.values()) { if (!groups.has(r.id)) groups.set(r.id, []); groups.get(r.id).push(r); }
  const entries = [], conflicts = [];
  for (const versions of groups.values()) {
    if (versions.some(r => r.bucket !== versions[0].bucket || r.createdAt !== versions[0].createdAt)) throw new Error('Timeline identity metadata changed. Sync was not applied.');
    const suppressed = new Set(versions.flatMap(r => r.supersedes));
    const heads = versions.filter(r => !suppressed.has(r.revisionId)).sort(compareRevision);
    if (!heads.length) throw new Error('Circular timeline revisions. Sync was not applied.');
    entries.push(heads.at(-1)); conflicts.push(...heads.slice(0, -1));
  }
  return { entries, conflicts };
}
export function validateCollection(rows, { uniqueIds = true } = {}) {
  if (!Array.isArray(rows)) throw new Error('Missing timeline records.');
  const ids = new Set();
  for (const r of rows) { validateEntry(r); const key = uniqueIds ? r.id : r.revisionId; if (ids.has(key)) throw new Error('Duplicate timeline record.'); ids.add(key); }
  return rows;
}
