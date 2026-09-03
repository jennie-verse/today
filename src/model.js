// model.js — shape validation, length clamping, pure task rules.
// No DOM access, no storage access.

export const LIMITS = {
  title: 140,
  subtaskTitle: 100,
  note: 2000,
};

// ---------- row kind (brain-dump stage 1) ----------
// A row's `type` is independent of its `status` lifecycle below.
//   'task'  — checkbox, default when missing (keeps old records reading correctly)
//   'note'  — dash marker, no checkbox; sent to Done via the row menu's Archive action
//   'event' — time badge; auto-promoted to Today when scheduledFor is today
export const TYPES = new Set(["task", "note", "event"]);

export function taskType(task) {
  return TYPES.has(task?.type) ? task.type : "task";
}

export const FONT_STEPS = [6, 8, 10, 12, 14, 17];
export const DEFAULT_SETTINGS = {
  font: 12,
  onboarded: false,
  lastBackupAt: null,
};

export function clampText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

export function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function todayKey(now = new Date()) {
  return dateKey(now);
}

export function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// ---------- task normalization ----------

// A task's lifecycle lives entirely in `status`:
//   'today'   — in today's list (unlimited) for `todayDate`
//   'someday' — backlog; may carry a `scheduledFor` proposal (not a deadline)
//   'done'    — completed; grouped by `doneDate`
export const STATUSES = new Set(["today", "someday", "done"]);

export function normalizeSubtask(draft) {
  const title = clampText(draft?.title, LIMITS.subtaskTitle);
  if (!title) throw { field: "subtask", message: "Subtask title is required." };
  return { id: draft?.id || makeId(), title, done: !!draft?.done };
}

export function normalizeTask(draft) {
  const type = TYPES.has(draft.type) ? draft.type : "task";
  // Note content preserves internal line breaks (clampText only trims the
  // ends) and gets the longer LIMITS.note ceiling; task/event titles keep
  // the existing LIMITS.title ceiling.
  const title = clampText(draft.title, type === "note" ? LIMITS.note : LIMITS.title);
  if (!title) throw { field: "title", message: "Title is required." };
  const status = STATUSES.has(draft.status) ? draft.status : "someday";
  const subtasks = Array.isArray(draft.subtasks)
    ? draft.subtasks.map(normalizeSubtask)
    : [];
  return {
    id: draft.id || makeId(),
    title,
    type,
    status,
    order: Number.isFinite(draft.order) ? draft.order : null,
    todayDate: status === "today" ? (draft.todayDate || null) : null,
    scheduledFor: draft.scheduledFor || null,
    scheduledAtMinutes: Number.isFinite(draft.scheduledAtMinutes) ? draft.scheduledAtMinutes : null,
    doneAt: status === "done" ? (draft.doneAt || new Date().toISOString()) : null,
    doneDate: status === "done" ? (draft.doneDate || dateKey(new Date())) : null,
    subtasks,
    source: draft.source === "tide" ? "tide" : "manual",
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function subtaskProgress(task) {
  const subtasks = task.subtasks || [];
  return { total: subtasks.length, done: subtasks.filter((s) => s.done).length };
}

// ---------- Today list (unlimited — no slot ceiling) ----------

export function countTodaySlots(tasks, todayDateKey) {
  return tasks.filter((t) => t.status === "today" && t.todayDate === todayDateKey).length;
}

// Today has no upper bound anymore; promotion is always allowed.
export function canPromoteToToday() {
  return true;
}

// Reconciliation run on load: a task left over in Today from a previous day
// rolls forward to today's date and stays in Today — nothing marked "today"
// and left unfinished ever silently drops out of the list on its own.
export function reconcileToday(tasks, todayDateKey) {
  const rolled = [];
  const next = tasks.map((t) => {
    if (t.status === "today" && t.todayDate !== todayDateKey) {
      rolled.push(t.id);
      return { ...t, todayDate: todayDateKey, updatedAt: new Date().toISOString() };
    }
    return t;
  });
  return { tasks: next, rolled };
}

// "Today candidates" — Someday items whose scheduledFor is today. Never
// auto-added to Today; shown only as a shortlist to pick from.
export function todayCandidates(tasks, todayDateKey) {
  return tasks.filter((t) => t.status === "someday" && t.scheduledFor === todayDateKey);
}

export function somedayTasks(tasks) {
  return tasks.filter((t) => t.status === "someday");
}

export function doneTasksByDate(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (t.status !== "done") continue;
    const key = t.doneDate || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

// No upper bound: every Today-status task for the day is shown.
export function todaySlotTasks(tasks, todayDateKey) {
  return tasks.filter((t) => t.status === "today" && t.todayDate === todayDateKey);
}

// Next `order` value for a status bucket — appended to the end of that
// bucket's current ordering. Used whenever a task is created or moves into a
// different status bucket (Someday/Today/Done each keep their own sequence).
export function nextOrder(tasks, status) {
  const max = tasks.reduce((m, t) => (
    t.status === status && Number.isFinite(t.order) ? Math.max(m, t.order) : m
  ), -1);
  return max + 1;
}

// ---------- type/order migration (boot-time, one-time, additive) ----------
//
// Records saved before `type`/`order` existed have neither field. Assign
// `order` by ascending createdAt, numbered separately per status bucket
// (today/someday/done) so existing on-screen ordering is preserved. `type`
// already defaults to "task" via normalizeTask, so nothing to backfill there.
// Returns only the records that actually needed a write.
export function migrateOrder(tasks) {
  const changed = [];
  for (const status of STATUSES) {
    const bucket = tasks
      .filter((t) => t.status === status && !Number.isFinite(t.order))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const base = tasks.reduce((max, t) => (
      t.status === status && Number.isFinite(t.order) ? Math.max(max, t.order) : max
    ), -1);
    bucket.forEach((t, i) => changed.push({ ...t, order: base + 1 + i, updatedAt: t.updatedAt || new Date().toISOString() }));
  }
  return changed;
}

// ---------- Today 3-tier sort (plan §3-2) ----------
//
// Event (ascending scheduledAtMinutes, no value sorts last) -> Task (ascending
// order) -> Note (ascending order). Returns rows tagged with a `tier` index
// (0/1/2) so the UI can draw a subtle divider between tiers.
export function todayTierGroups(tasks) {
  const events = tasks.filter((t) => taskType(t) === "event")
    .sort((a, b) => {
      const av = Number.isFinite(a.scheduledAtMinutes) ? a.scheduledAtMinutes : Infinity;
      const bv = Number.isFinite(b.scheduledAtMinutes) ? b.scheduledAtMinutes : Infinity;
      return av - bv;
    });
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  const notes = tasks.filter((t) => taskType(t) === "note").sort(byOrder);
  const plainTasks = tasks.filter((t) => taskType(t) === "task").sort(byOrder);
  return { events, tasks: plainTasks, notes };
}

export function sortTodayTiers(tasks) {
  const { events, tasks: plainTasks, notes } = todayTierGroups(tasks);
  return [
    ...events.map((t) => ({ task: t, tier: 0 })),
    ...plainTasks.map((t) => ({ task: t, tier: 1 })),
    ...notes.map((t) => ({ task: t, tier: 2 })),
  ];
}

// Move a task up/down within its own Today tier only (plan §3-2: "위로/아래로
// 이동은 같은 덩어리 안에서만"). `tierTasks` must already be the sorted tier
// list (events, plain tasks, or notes) containing `task`. Returns the pair of
// tasks whose `order` needs to swap, or [] if the move isn't possible (task
// missing from the list, or already at that edge) — events aren't order-
// sorted so moving them is a no-op by returning [].
export function moveWithinTier(tierTasks, taskId, direction) {
  const idx = tierTasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return [];
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= tierTasks.length) return [];
  const a = tierTasks[idx];
  const b = tierTasks[swapIdx];
  const aOrder = Number.isFinite(a.order) ? a.order : 0;
  const bOrder = Number.isFinite(b.order) ? b.order : 0;
  return [{ ...a, order: bOrder }, { ...b, order: aOrder }];
}

// Event auto-promotion only (plan §3-3, §1.2): a "someday" event whose
// scheduledFor is today moves to the top of Today. Tasks and notes are never
// auto-promoted. Returns { tasks, promoted } like reconcileToday.
export function autoPromoteEvents(tasks, todayDateKey) {
  const promoted = [];
  const next = tasks.map((t) => {
    if (t.type === "event" && t.status === "someday" && t.scheduledFor === todayDateKey) {
      promoted.push(t.id);
      return { ...t, status: "today", todayDate: todayDateKey, updatedAt: new Date().toISOString() };
    }
    return t;
  });
  return { tasks: next, promoted };
}

// ---------- Done, scoped to today (plan §8 stage 1 #5) ----------

export function todayDoneTasks(tasks, todayDateKey) {
  return tasks
    .filter((t) => t.status === "done" && t.doneDate === todayDateKey)
    .sort((a, b) => (a.doneAt || "").localeCompare(b.doneAt || ""));
}

// Done records left over from a previous day — deleted locally on boot after
// the journal hook has already sent them (see app.js cleanupOldDone).
export function staleDoneTasks(tasks, todayDateKey) {
  return tasks.filter((t) => t.status === "done" && t.doneDate !== todayDateKey);
}

// ---------- activity inference (for the local ledger and Journal) ----------

export function inferTaskAction(next, previous) {
  if (!previous) return "created";
  if (!next) return "deleted";
  if (previous.status !== "done" && next.status === "done") return "completed";
  if (previous.status === "done" && next.status !== "done") return "reopened";
  if (previous.status !== "today" && next.status === "today") return "promoted";
  if (previous.status === "today" && next.status === "someday") return "deferred";
  return "edited";
}
