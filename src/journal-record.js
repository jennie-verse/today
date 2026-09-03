// journal-record.js — shapes today's tasks into shared/v2 Journal records.
// A `task` record is only projected while a task is visible on a specific
// calendar day (status 'today', keyed by todayDate; or 'done', keyed by
// doneDate). A Someday task with only a scheduledFor proposal is never
// projected — that is what keeps a scheduledFor from acting like a deadline
// anywhere, including in Daybook.

const DEFAULT_ANCHOR_MINUTES = 540; // 09:00, used when no specific time was parsed

function pad(value) {
  return String(Math.abs(value)).padStart(2, "0");
}

export function localIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid journal timestamp");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${String(date.getMilliseconds()).padStart(3, "0")}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function dayIso(dateKeyStr, minutes) {
  const [year, month, day] = String(dateKeyStr).split("-").map(Number);
  const m = Number.isFinite(minutes) ? Math.max(0, Math.min(1439, minutes)) : DEFAULT_ANCHOR_MINUTES;
  return localIso(new Date(year, month - 1, day, Math.floor(m / 60), m % 60, 0, 0));
}

// Returns null when the task currently has no calendar day to project onto
// (a plain Someday task with no todayDate and not done).
export function journalDateFor(task) {
  if (task.status === "today" && task.todayDate) return task.todayDate;
  if (task.status === "done" && task.doneDate) return task.doneDate;
  return null;
}

export function taskToJournalRecord(task, options = {}) {
  const projectionDay = journalDateFor(task);
  if (!projectionDay || typeof task.id !== "string") throw new Error("Invalid Today task projection");

  let updatedAt;
  try { updatedAt = localIso(options.updatedAt || task.updatedAt); }
  catch { updatedAt = localIso(); }

  const includeContent = options.includeContent !== false;
  const includeSubtaskText = options.includeSubtaskText === true;
  const subtasks = task.subtasks || [];

  return {
    id: task.id,
    kind: "task",
    at: dayIso(projectionDay, task.scheduledAtMinutes),
    updatedAt,
    deleted: options.deleted === true,
    title: includeContent ? String(task.title || "Untitled task") : "Today task",
    data: {
      type: task.type === "note" || task.type === "event" ? task.type : "task",
      done: task.status === "done",
      subtaskCount: subtasks.length,
      subtaskDoneCount: subtasks.filter((s) => s.done).length,
      contentIncluded: includeContent,
      ...(includeContent && includeSubtaskText && subtasks.length
        ? { subtasks: subtasks.map((s) => ({ title: s.title, done: !!s.done })) }
        : {}),
    },
  };
}

export function taskActivityRecord(entry, task, { includeContent = true } = {}) {
  return {
    id: `${entry.taskId}:${entry.date}`,
    kind: "task-activity",
    at: entry.firstAt,
    updatedAt: entry.lastAt,
    deleted: false,
    title: includeContent ? String(task?.title || entry.title || "Untitled task") : "Today task",
    data: {
      activityDate: entry.date,
      actions: entry.actions,
      firstAt: entry.firstAt,
      lastAt: entry.lastAt,
      ...(entry.destination === "today" || entry.destination === "someday" ? { destination: entry.destination } : {}),
      done: entry.done === true,
      finalStatus: ["today", "someday", "done", "deleted"].includes(entry.finalStatus) ? entry.finalStatus : (entry.done ? "done" : entry.destination),
      contentIncluded: includeContent,
      historyAccuracy: "exact",
    },
  };
}
