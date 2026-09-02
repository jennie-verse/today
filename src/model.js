// model.js — shape validation, length clamping, pure task rules.
// No DOM access, no storage access.

export const LIMITS = {
  title: 140,
  subtaskTitle: 100,
};

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
  const title = clampText(draft.title, LIMITS.title);
  if (!title) throw { field: "title", message: "Title is required." };
  const status = STATUSES.has(draft.status) ? draft.status : "someday";
  const subtasks = Array.isArray(draft.subtasks)
    ? draft.subtasks.map(normalizeSubtask)
    : [];
  return {
    id: draft.id || makeId(),
    title,
    status,
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
