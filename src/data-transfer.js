// Whole-backup commit boundary, including crash-recoverable legacy task history.
import * as store from './store.js';
import * as sync from './sync.js';
import * as journal from './journal.js';
import { atomicData, readSnapshot, cleanEntry, dirtyMeta, notifyTimeline, TIMELINE_STORES } from './timeline-store.js';
import { mergeEntries, reviseEntry, newId } from './timeline-model.js';
const ALL = ['tasks', ...TIMELINE_STORES];
const signature = s => JSON.stringify([s.tasks.map(r => [r.id, r.updatedAt]).sort(), s.timelineEntries.map(r => [r.id, r.revisionId]).sort(), s.timelineConflicts.map(r => r.revisionId).sort()]);
export async function exportData() {
  const s = await readSnapshot(ALL);
  const pending = s.timelineMeta.find(r => r.key === 'restorePending');
  if (pending) throw new Error('Finish the pending restore before exporting. Use Retry restore in Settings.');
  return { format: 'today-backup', version: 2, exportedAt: new Date().toISOString(), tasks: s.tasks,
    journalActivity: journal.exportActivityLedger(), timelineEntries: s.timelineEntries.map(cleanEntry), timelineConflicts: s.timelineConflicts };
}
export async function restoreData(data, { replace = false, expectedSignature } = {}) {
  const baseline = journal.exportActivityLedger();
  const at = new Date().toISOString();
  const result = await atomicData(ALL, s => {
    if (s.timelineMeta.some(r => r.key === 'restorePending')) throw new Error('A restore is still pending. Retry it in Settings first.');
    if (expectedSignature && expectedSignature !== signature(s)) throw new Error('Records changed after import. Undo was not applied; your newer edits are kept.');
    const previous = { format: 'today-backup', version: 2, tasks: s.tasks, journalActivity: baseline,
      timelineEntries: s.timelineEntries.map(cleanEntry), timelineConflicts: s.timelineConflicts };
    const tasks = new Map((replace ? [] : s.tasks).map(r => [r.id, r]));
    for (const task of data.tasks) {
      const old = tasks.get(task.id);
      if (replace || !old || Date.parse(task.updatedAt) > Date.parse(old.updatedAt)) tasks.set(task.id, replace ? { ...task, updatedAt: new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1, ...s.tasks.filter(r => r.id === task.id).map(r => Date.parse(r.updatedAt) + 1))).toISOString() } : task);
    }
    let entries = s.timelineEntries.map(cleanEntry), conflicts = s.timelineConflicts;
    if (data.version === 2) {
      if (replace) {
        const old = new Map(entries.map(r => [r.id, r]));
        entries = data.timelineEntries.map(r => {
          const previous = old.get(r.id) || r; old.delete(r.id);
          return reviseEntry(r, previous, { known: [r, ...conflicts.filter(c => c.id === r.id)], allowFuture: true });
        });
        for (const r of old.values()) entries.push(r.deletedAt ? r : reviseEntry({ ...r, deletedAt: at }, r, { allowFuture: true }));
        conflicts = data.timelineConflicts;
      } else ({ entries, conflicts } = mergeEntries(entries, conflicts, data.timelineEntries, data.timelineConflicts));
    }
    const nextTasks = [...tasks.values()];
    const pending = { key: 'restorePending', id: newId(), at, beforeTasks: s.tasks, afterTasks: nextTasks,
      ledger: data.journalActivity === undefined ? null : { rows: data.journalActivity, baseline, merge: !replace } };
    const meta = dirtyMeta(s.timelineMeta, data.version === 2 ? entries.map(r => r.bucket) : []);
    meta.push(pending);
    const after = { ...s, tasks: nextTasks, timelineEntries: entries, timelineConflicts: conflicts };
    return { writes: { ...after, timelineMeta: meta }, value: { previous, signature: signature(after) } };
  });
  // The data is already committed. Failure here is a recoverable second phase.
  try { await recoverRestore(); } catch { result.pending = true; }
  notifyTimeline(); return result;
}
let recovering;
export function recoverRestore() {
  if (recovering) return recovering;
  recovering = recover().finally(() => { recovering = null; }); return recovering;
}
async function recover() {
  const s = await readSnapshot(ALL);
  const pending = s.timelineMeta.find(r => r.key === 'restorePending');
  if (!pending) return;
  const ids = new Set(s.tasks.map(r => r.id));
  const deleted = pending.beforeTasks.filter(r => !pending.afterTasks.some(t => t.id === r.id) && !ids.has(r.id));
  sync.mergeTaskTombstones(deleted.map(r => ({ id: r.id, deletedAt: pending.at })));
  for (const r of pending.afterTasks) if (ids.has(r.id)) sync.clearTaskTombstone(r.id);
  if (pending.ledger) {
    const current = journal.exportActivityLedger();
    const key = r => `${r.date}:${r.taskId}`;
    const baseline = new Map(pending.ledger.baseline.map(r => [key(r), JSON.stringify(r)]));
    const addedSince = current.filter(r => baseline.get(key(r)) !== JSON.stringify(r));
    // Preserve user actions performed after the DB commit while the ledger was blocked.
    journal.replaceActivityLedger(pending.ledger.rows, { merge: pending.ledger.merge });
    journal.replaceActivityLedger(addedSince, { merge: true });
  }
  await atomicData(['timelineMeta'], data => ({ writes: { timelineMeta: data.timelineMeta.filter(r => r.key !== 'restorePending' || r.id !== pending.id) } }));
  // Projection is optional; original tasks and the timeline are already restored.
  await journal.projectRestoredTasks(pending.afterTasks, pending.beforeTasks);
}
export async function resetData() {
  return restoreData({ format: 'today-backup', version: 2, tasks: [], journalActivity: [], timelineEntries: [], timelineConflicts: [] }, { replace: true });
}
