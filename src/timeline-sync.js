// New namespace leaves old clients' task snapshots untouched.
import * as sync from './sync.js';
import { readSnapshot, cleanEntry, mergeRemote, acknowledgeBucket } from './timeline-store.js';
import { mergeEntries, validateCollection } from './timeline-model.js';
const ROOT = 'today/timeline';
const MAX_BYTES = 900000;
let active;
export function decodeTimeline(file, { context, bucket }) {
  const data = JSON.parse(file);
  if (data?.v !== 1 || data.app !== 'today-timeline' || data.context !== context || data.bucket !== bucket) throw new Error('Unsupported timeline sync file. Existing data was kept.');
  validateCollection(data.entries); validateCollection(data.conflicts, { uniqueIds: false });
  if ([...data.entries, ...data.conflicts].some(r => r.bucket !== bucket)) throw new Error('Timeline record is in the wrong month.');
  return data;
}
export function encodeTimeline({ context, bucket, entries, conflicts }) {
  const text = JSON.stringify({ v: 1, app: 'today-timeline', context, bucket, entries, conflicts });
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Object.assign(new Error('Timeline month is too large to sync. Export JSON to keep a backup.'), { type: 'toolarge' });
  return text;
}
export function runTimelineSync(options = {}) {
  if (active) return active;
  active = run(options).finally(() => { active = null; }); return active;
}
async function run({ api: providedApi, ready = sync.isReady, config = sync.config, context = sync.getContextId } = {}) {
  if (!ready()) return { skipped: true };
  const api = providedApi || await import('../../shared/v1/sync.js');
  const cfg = config(), ctx = context();
  const snapshot = await readSnapshot();
  const meta = new Map(snapshot.timelineMeta.map(r => [r.key, r.value]));
  const buckets = new Set([...snapshot.timelineEntries.map(r => r.bucket), ...snapshot.timelineConflicts.map(r => r.bucket)]);
  const dirs = await api.listDir(cfg, ROOT);
  dirs.filter(d => d.type === 'dir' && /^\d{4}-\d{2}$/.test(d.name)).forEach(d => buckets.add(d.name));
  let pulled = 0;
  const errors = [];
  for (const bucket of [...buckets].sort().reverse()) {
    try {
      const base = `${ROOT}/${bucket}`, files = await api.listDir(cfg, base), seen = [];
      for (const entry of files.filter(f => f.type === 'file' && /^data\.[a-z0-9-]+\.json$/i.test(f.name))) {
        if (entry.sha && meta.get(`sha:${entry.path}`) === entry.sha) continue;
        const file = await api.readFile(cfg, entry.path);
        if (!file.exists) throw new Error('A timeline file changed during sync. Try Sync now.');
        const remote = decodeTimeline(file.content, { context: entry.name.slice(5, -5), bucket });
        await mergeRemote(remote.entries, remote.conflicts); pulled += remote.entries.length;
        seen.push({ path: entry.path, sha: file.sha });
      }
      let local = await readSnapshot();
      const token = local.timelineMeta.find(r => r.key === `dirty:${bucket}`)?.value;
      if (!token) { await acknowledgeBucket(bucket, null, seen); continue; }
      const path = `${base}/data.${ctx}.json`;
      let sentToken;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const previous = await api.readFile(cfg, path);
          const remote = previous.exists ? decodeTimeline(previous.content, { context: ctx, bucket }) : { entries: [], conflicts: [] };
          await mergeRemote(remote.entries, remote.conflicts);
          local = await readSnapshot();
          sentToken = local.timelineMeta.find(r => r.key === `dirty:${bucket}`)?.value;
          const merged = mergeEntries(local.timelineEntries.filter(r => r.bucket === bucket).map(cleanEntry), local.timelineConflicts.filter(r => r.bucket === bucket));
          const body = encodeTimeline({ context: ctx, bucket, ...merged });
          await api.writeFile(cfg, path, body, { sha: previous.sha || undefined, message: `today: update timeline ${bucket}` });
          await acknowledgeBucket(bucket, sentToken, seen);
          break;
        } catch (error) { if (error.type !== 'conflict' || attempt === 2) throw error; }
      }
    } catch (error) { errors.push(error); }
  }
  if (errors.length) return { pulled, error: errors[0] };
  return { pulled };
}
