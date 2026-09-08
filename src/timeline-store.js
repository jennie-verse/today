import { isoAt } from './timeline-time.js';
import { openDB } from './store.js';
import { newId, reviseEntry, mergeEntries, validateCollection } from './timeline-model.js';
export const TIMELINE_STORES = ['timelineEntries', 'timelineConflicts', 'timelineMeta'];
const listeners = new Set();
let channel;
export function onTimelineChange(fn) {
  listeners.add(fn);
  if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('today-timeline');
    channel.onmessage = () => notifyTimeline('remote', false);
  }
  return () => listeners.delete(fn);
}
export function notifyTimeline(origin = 'local', broadcast = true) {
  for (const fn of listeners) { try { fn(origin); } catch { /* UI cannot undo a committed write */ } }
  if (broadcast) channel?.postMessage({ changed: true });
}
export async function readSnapshot(names = TIMELINE_STORES) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readonly'), result = {};
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not read saved records.'));
    for (const name of names) {
      const req = tx.objectStore(name).getAll(); req.onsuccess = () => { result[name] = req.result; };
    }
  });
}
// Transform is synchronous and executes inside the transaction, after all reads.
// Never await network or a second transaction inside this boundary.
export async function atomicData(names, transform) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite'), snapshot = {};
    let left = names.length, result, failed;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failed || tx.error || new Error('Save was cancelled. Your input is kept.'));
    for (const name of names) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => {
        snapshot[name] = req.result;
        if (--left) return;
        try {
          const output = transform(snapshot);
          result = output.value;
          for (const [storeName, rows] of Object.entries(output.writes || {})) {
            const store = tx.objectStore(storeName); store.clear();
            for (const row of rows) store.put(storeName === 'timelineEntries' ? { ...row, runningKey: !row.deletedAt && row.isRunning ? 1 : 0 } : row);
          }
        } catch (error) { failed = error; tx.abort(); }
      };
    }
  });
}
// Derived index keys do not enter backups/sync, keeping revision payloads canonical.
export const cleanEntry = ({ runningKey: _key, ...entry }) => entry;
export function dirtyMeta(meta, buckets) {
  const result = new Map(meta.map(r => [r.key, r]));
  for (const bucket of new Set(buckets)) result.set(`dirty:${bucket}`, { key: `dirty:${bucket}`, value: newId() });
  return [...result.values()];
}
export async function readDay(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['timelineEntries', 'timelineConflicts'], 'readonly');
    const store = tx.objectStore('timelineEntries'), found = new Map();
    let conflicts = [];
    const add = req => { req.onsuccess = () => req.result.forEach(r => { if (!r.deletedAt) found.set(r.id, cleanEntry(r)); }); };
    add(store.index('startDate').getAll(date));
    add(store.index('endDate').getAll(IDBKeyRange.lowerBound(date)));
    add(store.index('runningKey').getAll(1));
    const req = tx.objectStore('timelineConflicts').getAll(); req.onsuccess = () => { conflicts = req.result; };
    tx.oncomplete = () => resolve({ entries: [...found.values()].filter(r => r.startDate === date || r.isRunning || (r.startDate < date && r.endedAt.slice(0, 19) > `${date}T00:00:00`)), conflicts });
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not load timeline.'));
  });
}
export async function saveEntry(draft, { expectedRevision = null, switchCurrent = false, resolve = false, now = Date.now(), allowFuture = false } = {}) {
  const result = await atomicData(TIMELINE_STORES, snapshot => {
    const entries = snapshot.timelineEntries.map(cleanEntry);
    const previous = entries.find(r => r.id === draft.id) || null;
    if ((previous?.revisionId || null) !== expectedRevision) throw new Error('This record changed in another tab or device. Close and reopen it before saving; your input is still here.');
    const alternatives = snapshot.timelineConflicts.filter(r => r.id === draft.id);
    const next = reviseEntry(draft, previous, { now, known: resolve ? alternatives : [], allowFuture });
    const others = entries.filter(r => r.id !== next.id && r.isRunning && !r.deletedAt);
    if (next.isRunning && others.length && !switchCurrent) {
      const error = new Error('Another activity is current.'); error.running = others; throw error;
    }
    const changed = new Map([[next.id, next]]);
    if (next.isRunning && switchCurrent) for (const r of others) {
      changed.set(r.id, reviseEntry({ ...r, endedAt: isoAt(Date.parse(next.startedAt), r.timeZone), timeZone: r.timeZone }, r, { now }));
    }
    // Convert a switch instant to each previous activity's own zone.
    const output = entries.map(r => changed.get(r.id) || r);
    if (!previous) output.push(next);
    return { writes: { timelineEntries: output,
      timelineConflicts: resolve ? snapshot.timelineConflicts.filter(r => r.id !== next.id) : snapshot.timelineConflicts,
      timelineMeta: dirtyMeta(snapshot.timelineMeta, [...changed.values()].map(r => r.bucket)),
    }, value: next };
  });
  notifyTimeline(); return result;
}
export async function mergeRemote(rows, conflicts = []) {
  validateCollection(rows); validateCollection(conflicts, { uniqueIds: false });
  await atomicData(TIMELINE_STORES, snapshot => {
    const merged = mergeEntries(snapshot.timelineEntries.map(cleanEntry), snapshot.timelineConflicts, rows, conflicts);
    return { writes: { timelineEntries: merged.entries, timelineConflicts: merged.conflicts } };
  });
  notifyTimeline('remote');
}
export async function acknowledgeBucket(bucket, sentToken, paths = []) {
  await atomicData(['timelineMeta'], snapshot => {
    const meta = new Map(snapshot.timelineMeta.map(r => [r.key, r]));
    if (meta.get(`dirty:${bucket}`)?.value === sentToken) meta.delete(`dirty:${bucket}`);
    for (const { path, sha } of paths) meta.set(`sha:${path}`, { key: `sha:${path}`, value: sha });
    return { writes: { timelineMeta: [...meta.values()] } };
  });
}
export async function setMeta(row) {
  await atomicData(['timelineMeta'], s => ({ writes: { timelineMeta: [...s.timelineMeta.filter(r => r.key !== row.key), row] } }));
}
