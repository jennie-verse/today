import {
  DEFAULT_SETTINGS,
  normalizeTask, subtaskProgress, todayKey, taskType,
  reconcileToday, todayCandidates, somedayTasks, todaySlotTasks,
  migrateOrder, sortTodayTiers, autoPromoteEvents, todayDoneTasks, staleDoneTasks,
  nextOrder, somedayFiltered, switchTaskKind, splitNoteLines, tasksFromNoteLines,
} from "./model.js";
import { parseNaturalLanguage } from "./nlp-date.js";
import * as store from "./store.js";
import * as journal from "./journal.js";
import * as syncRunner from "./sync-runner.js";
import { toast, confirmDialog, announce } from "./ui.js";
import { openSettingsSheet } from "./settings.js";

const $ = (id) => document.getElementById(id);

const state = { tasks: [], settings: DEFAULT_SETTINGS };

function applyFont() {
  document.documentElement.style.setProperty("--f", `${state.settings.font}px`);
}

async function loadTasks() {
  state.tasks = await store.getAllTasks();
}

async function reconcile() {
  const { tasks, rolled } = reconcileToday(state.tasks, todayKey());
  if (!rolled.length) { state.tasks = tasks; }
  else {
    const toWrite = tasks.filter((t) => rolled.includes(t.id));
    await store.bulkPutTasks(toWrite);
    state.tasks = tasks;
    journal.recordRollover(toWrite).catch(() => {});
  }

  // Event auto-promotion only (plan §3-3): a Someday event scheduled for
  // today moves to the top of Today. Tasks/notes are never auto-promoted.
  const { tasks: afterPromote, promoted } = autoPromoteEvents(state.tasks, todayKey());
  if (promoted.length) {
    const toWrite = afterPromote.filter((t) => promoted.includes(t.id));
    await store.bulkPutTasks(toWrite);
    state.tasks = afterPromote;
  }
}

// One-time additive migration: records saved before `type`/`order` existed
// get an `order` assigned by ascending createdAt, numbered separately per
// status bucket. Does not touch the IndexedDB schema version — same store,
// same keyPath, just filling in a field that used to be absent.
async function migrate() {
  const changed = migrateOrder(state.tasks);
  if (!changed.length) return;
  await store.bulkPutTasks(changed);
  const byId = new Map(changed.map((t) => [t.id, t]));
  state.tasks = state.tasks.map((t) => byId.get(t.id) || t);
}

// Done records from a previous day are deleted locally on boot, but only
// after the journal hook already sent them — which it did the moment each
// task was marked done (store.putTask -> notifyTaskChange -> journal.js).
// The delete itself runs through withoutTaskHook so it does NOT re-notify
// journal.js: that would enqueue a tombstone and erase the record from
// Daybook, which is the opposite of what "old items live on in Daybook"
// means. This only ever touches Published/today's own IndexedDB.
async function cleanupOldDone() {
  const stale = staleDoneTasks(state.tasks, todayKey());
  if (!stale.length) return;
  const staleIds = new Set(stale.map((t) => t.id));
  await store.withoutTaskHook(async () => {
    for (const t of stale) await store.deleteTaskById(t.id);
  });
  state.tasks = state.tasks.filter((t) => !staleIds.has(t.id));
}

async function refresh() {
  await loadTasks();
  await migrate();
  await reconcile();
  await cleanupOldDone();
  render();
}

// ---------- row builders ----------

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function subtaskRow(task, subtask) {
  const row = node("div", "subtask-row" + (subtask.done ? " done" : ""));
  const check = node("button", "check");
  check.type = "button";
  check.setAttribute("aria-label", `${subtask.done ? "Mark not done" : "Mark done"}: ${subtask.title}`);
  const dot = node("span", "dot");
  check.appendChild(dot);
  check.addEventListener("click", async () => {
    const next = { ...task, subtasks: task.subtasks.map((s) => s.id === subtask.id ? { ...s, done: !s.done } : s) };
    await store.putTask(normalizeTask({ ...next, status: next.status }));
    await refresh();
  });
  row.append(check, node("span", "title", subtask.title));
  return row;
}

function actionButton(label, glyph, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.textContent = glyph;
  b.addEventListener("click", onClick);
  return b;
}

async function completeTask(task) {
  const done = task.status !== "done";
  const destStatus = done ? "done" : "someday";
  const next = normalizeTask({
    ...task,
    status: destStatus,
    order: nextOrder(state.tasks, destStatus),
    doneAt: done ? new Date().toISOString() : null,
    doneDate: done ? todayKey() : null,
  });
  await store.putTask(next);
  announce(`${next.title} ${done ? "completed" : "reopened"}`);
  await refresh();
}

// Dismisses a "today candidate" suggestion without promoting it — clears
// scheduledFor so it stops matching todayCandidates and quietly stays a
// normal Someday item (still reachable there, just no longer suggested).
async function skipCandidate(task) {
  const next = normalizeTask({ ...task, scheduledFor: null });
  await store.putTask(next);
  toast(`Kept in Someday`);
  await refresh();
}

async function promoteTask(task) {
  const next = normalizeTask({ ...task, status: "today", order: nextOrder(state.tasks, "today"), todayDate: todayKey() });
  await store.putTask(next);
  toast(`Moved to Today`);
  await refresh();
}

async function deferTask(task) {
  const next = normalizeTask({ ...task, status: "someday", order: nextOrder(state.tasks, "someday"), todayDate: null });
  await store.putTask(next);
  toast(`Moved to Someday`);
  await refresh();
}

async function deleteTask(task) {
  const ok = await confirmDialog({
    title: "Delete task?",
    message: `"${task.title}" will be removed.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  await store.deleteTaskById(task.id);
  toast("Deleted");
  await refresh();
}

// Edits a task's title (and, for tasks created via natural-language input,
// its date/time) through the same NL parser and normalizeTask/store.putTask
// path as creation — so IndexedDB, sync, and Journal ("edited" activity via
// inferTaskAction) all stay consistent with every other mutation.
function openTaskEditor(task) {
  const overlay = node("div", "overlay");
  const frame = node("div", "frame");
  const sheet = node("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  const header = node("div", "sheet-hdr");
  const isNote = task.type === "note";
  header.append(node("h2", "", isNote ? "Edit note" : "Edit task"), (() => {
    const b = node("button", "ico", "✕"); b.type = "button"; b.setAttribute("aria-label", "Close"); return b;
  })());
  const closeBtn = header.lastChild;

  const body = node("div", "sheet-body");
  // Note keeps its multi-line textarea in Edit too — Enter must insert a
  // newline there (same as the add-bar's Note textarea), not submit. Only
  // Task/Event use the single-line input where Enter saves, and only those
  // go through the NL parser: a Note's raw text is never reinterpreted as a
  // date/time phrase and its internal newlines must survive the round trip.
  const input = isNote ? document.createElement("textarea") : document.createElement("input");
  if (!isNote) input.type = "text";
  input.maxLength = isNote ? 2000 : 200;
  input.value = task.title;
  input.style.width = "100%";
  if (isNote) { input.style.minHeight = "120px"; input.style.resize = "vertical"; }
  input.setAttribute("aria-label", isNote ? "Note text" : "Task title");
  const hint = node("p", "hint", isNote ? "" : "You can include a date/time, e.g. \"tomorrow 9am\".");
  body.append(input, hint);

  const foot = node("div", "sheet-foot");
  const cancelBtn = node("button", "btn ghost", "Cancel");
  cancelBtn.type = "button";
  const saveBtn = node("button", "btn primary", "Save");
  saveBtn.type = "button";
  foot.append(cancelBtn, saveBtn);

  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; });

  async function save() {
    if (composing) return;
    const raw = input.value;
    if (!raw.trim()) { toast("Title is required."); return; }
    try {
      let next;
      if (isNote) {
        next = normalizeTask({ ...task, title: raw, type: "note" });
      } else {
        const parsed = parseNaturalLanguage(raw, { now: new Date() });
        // Stage 1 has no kind-switching UI yet: a Task/Event's kind still
        // tracks whether the edited text carries a time, same rule as
        // creation (plan §2).
        const type = Number.isFinite(parsed.scheduledAtMinutes) ? "event" : "task";
        next = normalizeTask({
          ...task,
          title: parsed.title,
          type,
          scheduledFor: parsed.scheduledFor,
          scheduledAtMinutes: parsed.scheduledAtMinutes,
        });
      }
      await store.putTask(next);
      close();
      toast("Task updated");
      await refresh();
    } catch (err) {
      toast(err?.message || "Couldn't update that task");
    }
  }

  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", save);
  if (!isNote) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !composing) { e.preventDefault(); save(); }
    });
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  sheet.append(header, body, foot);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  $("sheet-host").appendChild(overlay);
  input.focus();
  input.select();
}

function openSubtaskEditor(task) {
  const overlay = node("div", "overlay");
  const frame = node("div", "frame");
  const sheet = node("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  const header = node("div", "sheet-hdr");
  header.append(node("h2", "", "Subtasks"), (() => {
    const b = node("button", "ico", "✕"); b.type = "button"; b.setAttribute("aria-label", "Close"); return b;
  })());
  const closeBtn = header.lastChild;

  const body = node("div", "sheet-body");
  const list = node("div", "group-list");
  body.appendChild(list);

  const addRow = node("div");
  addRow.style.display = "flex"; addRow.style.gap = "8px"; addRow.style.marginTop = "10px";
  const addInput = document.createElement("input");
  addInput.type = "text"; addInput.maxLength = 100; addInput.placeholder = "Add a subtask"; addInput.style.flex = "1";
  const addBtn = node("button", "btn", "Add");
  addBtn.type = "button";
  addRow.append(addInput, addBtn);
  const limitHint = node("p", "hint", "");
  body.append(addRow, limitHint);

  let current = task;
  function renderList() {
    list.replaceChildren();
    current.subtasks.forEach((s) => {
      const row = node("div", "subtask-row" + (s.done ? " done" : ""));
      const check = node("button", "check");
      check.type = "button";
      check.setAttribute("aria-label", `Toggle: ${s.title}`);
      check.appendChild(node("span", "dot"));
      check.addEventListener("click", async () => {
        current = normalizeTask({ ...current, subtasks: current.subtasks.map((x) => x.id === s.id ? { ...x, done: !x.done } : x) });
        await store.putTask(current);
        renderList();
      });
      const titleEl = node("span", "title", s.title);
      titleEl.style.cursor = "pointer";
      titleEl.setAttribute("role", "button");
      titleEl.setAttribute("tabindex", "0");
      titleEl.setAttribute("aria-label", `Edit: ${s.title}`);
      async function startEdit() {
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 100;
        input.value = s.title;
        input.style.flex = "1";
        row.replaceChild(input, titleEl);
        input.focus();
        input.select();
        let editComposing = false;
        input.addEventListener("compositionstart", () => { editComposing = true; });
        input.addEventListener("compositionend", () => { editComposing = false; });
        let done = false;
        async function commit() {
          if (done) return;
          done = true;
          const value = input.value.trim();
          if (value && value !== s.title) {
            current = normalizeTask({ ...current, subtasks: current.subtasks.map((x) => x.id === s.id ? { ...x, title: value.slice(0, 100) } : x) });
            await store.putTask(current);
          }
          renderList();
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !editComposing) { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { done = true; renderList(); }
        });
      }
      titleEl.addEventListener("click", startEdit);
      titleEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); }
      });
      const del = node("button", "", "✕");
      del.type = "button"; del.setAttribute("aria-label", `Remove: ${s.title}`);
      del.style.minWidth = "44px"; del.style.minHeight = "44px"; del.style.background = "none"; del.style.border = "0"; del.style.color = "var(--text-3)"; del.style.cursor = "pointer";
      del.addEventListener("click", async () => {
        current = normalizeTask({ ...current, subtasks: current.subtasks.filter((x) => x.id !== s.id) });
        await store.putTask(current);
        renderList();
      });
      row.append(check, titleEl, del);
      list.appendChild(row);
    });
    limitHint.textContent = current.subtasks.length
      ? `${current.subtasks.length} subtask${current.subtasks.length === 1 ? "" : "s"}. Tap a title to rename it.`
      : "No subtasks yet.";
  }
  renderList();

  let composing = false;
  addInput.addEventListener("compositionstart", () => { composing = true; });
  addInput.addEventListener("compositionend", () => { composing = false; });
  async function addSubtask() {
    if (composing) return;
    const title = addInput.value.trim();
    if (!title) return;
    current = normalizeTask({ ...current, subtasks: [...current.subtasks, { title, done: false }] });
    await store.putTask(current);
    addInput.value = "";
    renderList();
  }
  addBtn.addEventListener("click", addSubtask);
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !composing) { e.preventDefault(); addSubtask(); }
  });

  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
    refresh();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  sheet.append(header, body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  $("sheet-host").appendChild(overlay);
}

// Move up/down (from the row's ⋯ menu) swaps `order` with the adjacent
// neighbor in `tierList` — the caller passes whatever already-sorted list
// `task` belongs to: a Today tier (from sortTodayTiers) or the current
// Someday list (from somedayFiltered). No-op at either end of that list.
async function moveTask(task, direction, tierList) {
  const idx = tierList.findIndex((t) => t.id === task.id);
  const targetIdx = idx + direction;
  if (idx < 0 || targetIdx < 0 || targetIdx >= tierList.length) return;
  const other = tierList[targetIdx];
  const a = normalizeTask({ ...task, order: other.order ?? 0 });
  const b = normalizeTask({ ...other, order: task.order ?? 0 });
  await store.putTask(a);
  await store.putTask(b);
  await refresh();
}

// Task -> Note kind-switching drops subtasks (Notes have no subtask concept —
// decision documented in docs/TEST-REPORT.md §8). Warn/confirm first if any
// exist; Note -> Task never fabricates subtasks. Switching to/from "event"
// leaves scheduledFor/scheduledAtMinutes untouched (simplest safe option —
// the user picks a time afterwards via Edit if needed).
async function changeTaskKind(task, kind) {
  if (kind === taskType(task)) return;
  if (kind === "note" && task.subtasks?.length) {
    const ok = await confirmDialog({
      title: "Change to Note?",
      message: `${task.subtasks.length} subtask${task.subtasks.length === 1 ? "" : "s"} will be removed.`,
      confirmLabel: "Change to Note",
      danger: true,
    });
    if (!ok) return;
  }
  const next = switchTaskKind(task, kind);
  await store.putTask(next);
  toast("Kind changed");
  await refresh();
}

function openKindSheet(task) {
  const overlay = node("div", "overlay");
  const frame = node("div", "frame");
  const sheet = node("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  const header = node("div", "sheet-hdr");
  header.append(node("h2", "", "Change type"), (() => {
    const b = node("button", "ico", "✕"); b.type = "button"; b.setAttribute("aria-label", "Close"); return b;
  })());
  const closeBtn = header.lastChild;
  const body = node("div", "sheet-body menu-list");
  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  [["task", "☐ Task"], ["note", "— Note"], ["event", "⏱ Event"]].forEach(([kind, label]) => {
    body.appendChild(menuItemButton(label, () => { close(); changeTaskKind(task, kind); }));
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);
  sheet.append(header, body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  $("sheet-host").appendChild(overlay);
}

// Turn into tasks (plan §4): shows the note verbatim, splits only on
// newlines (blank lines discarded), each line is an editable checked-by-
// default row; "Create" creates the checked lines as new Someday Tasks with
// `order` continuing right after the source note's order. The original note
// is never modified or deleted.
function openTurnIntoTasksSheet(note) {
  const overlay = node("div", "overlay");
  const frame = node("div", "frame");
  const sheet = node("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  const header = node("div", "sheet-hdr");
  header.append(node("h2", "", "Turn into tasks"), (() => {
    const b = node("button", "ico", "✕"); b.type = "button"; b.setAttribute("aria-label", "Close"); return b;
  })());
  const closeBtn = header.lastChild;

  const body = node("div", "sheet-body");
  const original = node("p", "hint");
  original.style.whiteSpace = "pre-wrap";
  original.textContent = note.title;
  body.appendChild(original);

  const list = node("div", "group-list");
  body.appendChild(list);

  const lines = splitNoteLines(note.title);
  const rows = lines.map((text) => ({ text, checked: true }));

  function renderRows() {
    list.replaceChildren();
    rows.forEach((r, idx) => {
      const row = node("div", "subtask-row");
      const check = node("button", "check" + (r.checked ? "" : ""));
      check.type = "button";
      check.setAttribute("aria-label", `${r.checked ? "Uncheck" : "Check"}: ${r.text}`);
      const dot = node("span", "dot");
      if (r.checked) dot.style.background = "var(--accent)";
      check.appendChild(dot);
      check.addEventListener("click", () => { r.checked = !r.checked; renderRows(); });

      const titleEl = node("span", "title", r.text);
      titleEl.style.cursor = "pointer";
      titleEl.setAttribute("role", "button");
      titleEl.setAttribute("tabindex", "0");
      async function startEdit() {
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 140;
        input.value = r.text;
        input.style.flex = "1";
        row.replaceChild(input, titleEl);
        input.focus();
        input.select();
        let editComposing = false;
        input.addEventListener("compositionstart", () => { editComposing = true; });
        input.addEventListener("compositionend", () => { editComposing = false; });
        function commit() {
          const value = input.value.trim();
          if (value) { rows[idx] = { ...rows[idx], text: value }; }
          renderRows();
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !editComposing) { e.preventDefault(); input.blur(); }
          if (e.key === "Escape") { renderRows(); }
        });
      }
      titleEl.addEventListener("click", startEdit);
      titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); } });

      row.append(check, titleEl);
      list.appendChild(row);
    });
  }
  renderRows();

  const foot = node("div", "sheet-foot");
  const cancelBtn = node("button", "btn ghost", "Cancel");
  cancelBtn.type = "button";
  const createBtn = node("button", "btn primary", "Create");
  createBtn.type = "button";
  foot.append(cancelBtn, createBtn);

  createBtn.addEventListener("click", async () => {
    const chosen = rows.filter((r) => r.checked).map((r) => r.text);
    if (!chosen.length) { close(); return; }
    const drafts = tasksFromNoteLines(chosen, note.order);
    for (const draft of drafts) await store.putTask(draft);
    close();
    toast(`${drafts.length} task${drafts.length === 1 ? "" : "s"} created`);
    await refresh();
  });

  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);

  sheet.append(header, body, foot);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  $("sheet-host").appendChild(overlay);
}

function menuItemButton(label, onClick, { danger = false } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "menu-item" + (danger ? " danger" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// Row "⋯" menu (plan §3-6): consolidates the per-row actions that used to be
// separate icon buttons, plus the new move up/down actions. Only the items
// relevant to stage 1's feature set — no Turn-into-tasks, no kind-switching.
function openRowMenu(task, { context, tierList }) {
  const overlay = node("div", "overlay");
  const frame = node("div", "frame");
  const sheet = node("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  const header = node("div", "sheet-hdr");
  header.append(node("h2", "", task.title), (() => {
    const b = node("button", "ico", "✕"); b.type = "button"; b.setAttribute("aria-label", "Close"); return b;
  })());
  const closeBtn = header.lastChild;

  const body = node("div", "sheet-body menu-list");

  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function act(fn) { return () => { close(); fn(); }; }

  const kind = taskType(task);
  body.appendChild(menuItemButton("Edit", act(() => openTaskEditor(task))));
  if (context !== "done" && kind === "task") {
    body.appendChild(menuItemButton("Edit subtasks", act(() => openSubtaskEditor(task))));
  }
  if (context === "today") {
    body.appendChild(menuItemButton("Move up", act(() => moveTask(task, -1, tierList))));
    body.appendChild(menuItemButton("Move down", act(() => moveTask(task, 1, tierList))));
    body.appendChild(menuItemButton("Move to Someday", act(() => deferTask(task))));
  } else if (context === "someday") {
    body.appendChild(menuItemButton("Move up", act(() => moveTask(task, -1, tierList))));
    body.appendChild(menuItemButton("Move down", act(() => moveTask(task, 1, tierList))));
    body.appendChild(menuItemButton("Move to Today", act(() => promoteTask(task))));
  } else if (context === "done") {
    body.appendChild(menuItemButton("Reopen", act(() => completeTask(task))));
  }
  // Note has no checkbox — 정리함(Archive) is its only way into Done, and
  // reuses the same status/doneAt/doneDate fields as completing a task.
  if (context !== "done" && kind === "note") {
    body.appendChild(menuItemButton("Archive to Done", act(() => completeTask(task))));
  }
  if (context !== "done") {
    body.appendChild(menuItemButton("Change type", act(() => openKindSheet(task))));
  }
  if (context !== "done" && kind === "note") {
    body.appendChild(menuItemButton("Turn into tasks", act(() => openTurnIntoTasksSheet(task))));
  }
  body.appendChild(menuItemButton("Delete", act(() => deleteTask(task)), { danger: true }));

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);

  sheet.append(header, body);
  frame.appendChild(sheet);
  overlay.appendChild(frame);
  $("sheet-host").appendChild(overlay);
}

function formatClock(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Note has no checkbox (plan §1.3/§3-6) — a plain dash marker instead, kept
// even after archiving to Done. Event shows a time badge in place of the
// checkbox when it has a scheduledAtMinutes; otherwise it behaves like a task.
function taskRow(task, { context, tierList = [] }) {
  const wrap = node("div");
  const kind = taskType(task);
  const row = node("div", "task-row" + (task.status === "done" ? " done" : "") + ` type-${kind}`);

  if (kind === "note") {
    row.appendChild(node("span", "kind-mark", "—"));
  } else if (kind === "event" && Number.isFinite(task.scheduledAtMinutes)) {
    const badge = node("span", "kind-mark time-badge", formatClock(task.scheduledAtMinutes));
    badge.setAttribute("aria-label", `Scheduled ${formatClock(task.scheduledAtMinutes)}`);
    row.appendChild(badge);
  } else {
    const check = node("button", "check");
    check.type = "button";
    check.setAttribute("aria-label", task.status === "done" ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`);
    check.appendChild(node("span", "dot"));
    check.addEventListener("click", () => completeTask(task));
    row.appendChild(check);
  }

  const main = node("div", "main");
  const titleEl = node("div", "title", task.title);
  // Someday Note cards clamp to 4 lines (plan §3-4); tapping toggles the
  // .expanded class. textContent only — no innerHTML.
  if (context === "someday" && kind === "note") {
    titleEl.classList.add("note-clamp");
    titleEl.setAttribute("role", "button");
    titleEl.setAttribute("tabindex", "0");
    titleEl.setAttribute("aria-label", "Expand note");
    const toggle = () => titleEl.classList.toggle("expanded");
    titleEl.addEventListener("click", toggle);
    titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  }
  main.appendChild(titleEl);
  const progress = subtaskProgress(task);
  if (progress.total) main.appendChild(node("div", "sub-progress", `${progress.done}/${progress.total} subtasks`));
  row.appendChild(main);

  const actions = node("div", "actions");
  actions.appendChild(actionButton("More actions", "⋯", () => openRowMenu(task, { context, tierList })));
  row.appendChild(actions);

  wrap.appendChild(row);

  if (progress.total) {
    const list = node("div", "subtasks");
    task.subtasks.forEach((s) => list.appendChild(subtaskRow(task, s)));
    wrap.appendChild(list);
  }
  return wrap;
}

// ---------- Someday filter chips (plan §3-4) ----------

const SOMEDAY_FILTERS = [["all", "All"], ["task", "☐ Tasks"], ["note", "— Notes"]];

function renderSomedayFilterChips() {
  const host = $("someday-filter-chips");
  host.replaceChildren();
  SOMEDAY_FILTERS.forEach(([value, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", String((state.settings.somedayFilter || "all") === value));
    b.addEventListener("click", async () => {
      state.settings = store.setSettings({ somedayFilter: value });
      render();
    });
    host.appendChild(b);
  });
}

// ---------- render ----------

function render() {
  applyFont();
  const key = todayKey();

  const slots = todaySlotTasks(state.tasks, key);
  $("today-count").textContent = `${slots.length}`;
  const slotsHost = $("today-slots");
  slotsHost.replaceChildren();
  if (!slots.length) {
    slotsHost.appendChild(node("div", "slot empty", "Nothing in Today — add a task or move one from Someday"));
  } else {
    // 3-tier sort (plan §3-2): Event -> Task -> Note, with a subtle divider
    // drawn between tiers. Move up/down only reorders within the tierList
    // the row belongs to.
    const tiered = sortTodayTiers(slots);
    let lastTier = null;
    tiered.forEach(({ task, tier }) => {
      if (lastTier !== null && tier !== lastTier) {
        slotsHost.appendChild(node("div", "tier-divider"));
      }
      lastTier = tier;
      const tierList = tiered.filter((r) => r.tier === tier).map((r) => r.task);
      const box = node("div", "slot");
      box.appendChild(taskRow(task, { context: "today", tierList }));
      slotsHost.appendChild(box);
    });
  }

  const candidates = todayCandidates(state.tasks, key);
  $("section-candidates").hidden = candidates.length === 0;
  $("candidates-count").textContent = `(${candidates.length})`;
  const candHost = $("candidates-list");
  candHost.replaceChildren();
  candidates.forEach((task) => {
    const row = node("div", "candidate-row");
    row.appendChild(node("div", "title", task.title));
    const actions = node("div", "candidate-actions");
    const skipBtn = node("button", "ghost", "Keep in Someday");
    skipBtn.type = "button";
    skipBtn.setAttribute("aria-label", `Keep in Someday: ${task.title}`);
    skipBtn.addEventListener("click", () => skipCandidate(task));
    const btn = node("button", "", "Add to Today");
    btn.type = "button";
    btn.addEventListener("click", () => promoteTask(task));
    actions.append(skipBtn, btn);
    row.appendChild(actions);
    candHost.appendChild(row);
  });

  renderSomedayFilterChips();
  // Someday sorts by `order` ascending — input order — replacing the old
  // scheduledFor/title sort (plan §3-4). Filter chip narrows by kind.
  const someday = somedayFiltered(state.tasks, state.settings.somedayFilter);
  $("someday-count").textContent = `(${someday.length})`;
  const somedayHost = $("someday-list");
  somedayHost.replaceChildren();
  if (!someday.length) somedayHost.appendChild(node("p", "empty-hint", "Nothing in Someday."));
  someday.forEach((task) => {
    const kind = taskType(task);
    const box = node("div", "someday-row" + (kind === "note" ? " type-note" : ""));
    box.appendChild(taskRow(task, { context: "someday", tierList: someday }));
    somedayHost.appendChild(box);
  });

  // Done is scoped to today only (plan §8 stage 1 #5) — items done on a
  // previous day are cleaned up on boot (see cleanupOldDone) and live on in
  // Daybook instead.
  const doneToday = todayDoneTasks(state.tasks, key);
  $("done-count").textContent = `(${doneToday.length})`;
  const doneHost = $("done-list");
  doneHost.replaceChildren();
  if (!doneToday.length) {
    doneHost.appendChild(node("p", "empty-hint", "Nothing done yet."));
  } else {
    doneToday.forEach((task) => doneHost.appendChild(taskRow(task, { context: "done" })));
  }
  doneHost.appendChild(node("p", "empty-hint done-note", "Older Done items are no longer kept here — see Daybook."));
}

// ---------- add bar ----------

const ADD_KINDS = [["task", "☐ Task"], ["note", "— Note"], ["event", "⏱ Event"]];
let composingAdd = false;
let composingNote = false;

function currentAddKind() {
  const kind = state.settings.lastAddKind;
  return ADD_KINDS.some(([k]) => k === kind) ? kind : "task";
}

function applyAddKindUI() {
  const input = $("add-input");
  const textarea = $("add-textarea");
  const isNote = currentAddKind() === "note";
  // Note grows the input into a ~3-line textarea that preserves newlines
  // (plan §3-1); Task/Event keep the single-line input, whose kind is still
  // resolved by the NL parser at submit time (a parsed time -> Event).
  input.hidden = isNote;
  textarea.hidden = !isNote;
  $("add-kind-chips").querySelectorAll(".chip").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.kind === currentAddKind()));
  });
}

function wireAddKindChips() {
  const host = $("add-kind-chips");
  host.replaceChildren();
  ADD_KINDS.forEach(([kind, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.kind = kind;
    b.textContent = label;
    b.addEventListener("click", () => {
      state.settings = store.setSettings({ lastAddKind: kind });
      applyAddKindUI();
      (kind === "note" ? $("add-textarea") : $("add-input")).focus();
    });
    host.appendChild(b);
  });
  applyAddKindUI();
}

function wireAddBar() {
  const input = $("add-input");
  const textarea = $("add-textarea");
  const submit = $("add-submit");
  input.addEventListener("compositionstart", () => { composingAdd = true; });
  input.addEventListener("compositionend", () => { composingAdd = false; });
  // Same Korean IME composition guard as the existing input, replicated on
  // the new Note textarea so Enter during composition never submits early.
  textarea.addEventListener("compositionstart", () => { composingNote = true; });
  textarea.addEventListener("compositionend", () => { composingNote = false; });

  async function submitAdd() {
    const isNote = currentAddKind() === "note";
    if (isNote) {
      if (composingNote) return;
      const raw = textarea.value;
      if (!raw.trim()) return;
      try {
        // Note preserves internal newlines — clampText only trims the ends
        // (plan §2 clampText note-branch).
        const task = normalizeTask({
          title: raw,
          type: "note",
          status: "someday",
          order: nextOrder(state.tasks, "someday"),
        });
        await store.putTask(task);
        textarea.value = "";
        await refresh();
        toast("Added to Someday");
      } catch (err) {
        toast(err?.message || "Couldn't add that note");
      }
      return;
    }
    if (composingAdd) return;
    const raw = input.value;
    if (!raw.trim()) return;
    const parsed = parseNaturalLanguage(raw, { now: new Date() });
    try {
      // A parsed time makes it an Event (plan §2), otherwise it keeps
      // whichever of Task/Event the chips selected (Note is handled above).
      const type = Number.isFinite(parsed.scheduledAtMinutes) ? "event" : (currentAddKind() === "event" ? "event" : "task");
      const task = normalizeTask({
        title: parsed.title,
        type,
        status: "someday",
        order: nextOrder(state.tasks, "someday"),
        scheduledFor: parsed.scheduledFor,
        scheduledAtMinutes: parsed.scheduledAtMinutes,
      });
      await store.putTask(task);
      input.value = "";
      await refresh();
      toast(parsed.scheduledFor ? `Added to Someday · ${parsed.scheduledFor}` : "Added to Someday");
    } catch (err) {
      toast(err?.message || "Couldn't add that task");
    }
  }

  submit.addEventListener("click", submitAdd);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !composingAdd) { e.preventDefault(); submitAdd(); }
  });
  // Enter inserts a newline in the Note textarea (multi-line input) — only
  // the ＋ button submits a note, unlike the single-line Task/Event input.
  wireAddKindChips();
}

// ---------- URL intake (?add=) — used by tide's "Send to today" ----------

function handleUrlIntake() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  const add = params.get("add");
  if (add == null) return;
  try { history.replaceState({}, "", location.pathname + location.hash); } catch { /* ignore */ }
  if (!add.trim()) return;
  const parsed = parseNaturalLanguage(add, { now: new Date() });
  // clip readiness (plan §5/stage 2 prep): accept ?from=clip the same way
  // ?from=tide is already accepted. clip doesn't exist yet — inert until it
  // does, but today-side handling is ready.
  const fromParam = params.get("from");
  const source = fromParam === "tide" ? "tide" : fromParam === "clip" ? "clip" : "manual";
  const type = Number.isFinite(parsed.scheduledAtMinutes) ? "event" : "task";
  store.putTask(normalizeTask({
    title: parsed.title, type, status: "someday", order: nextOrder(state.tasks, "someday"),
    scheduledFor: parsed.scheduledFor, scheduledAtMinutes: parsed.scheduledAtMinutes, source,
  }))
    .then(refresh)
    .then(() => toast(`Added to Someday from ${source === "tide" ? "Tide" : source === "clip" ? "Clip" : "link"}`));
}

// ---------- boot ----------

async function boot() {
  state.settings = store.getSettings();
  applyFont();
  // Local changes start queueing (tombstones/pushes) immediately, even while
  // sync is off — turning it on later should not treat everything since
  // install as new. Matches loom's boot order.
  syncRunner.attach();
  journal.attachJournal();
  await refresh();
  handleUrlIntake();
  wireAddBar();
  $("open-settings").addEventListener("click", () => {
    openSettingsSheet({ onChanged: (settings) => { state.settings = settings; applyFont(); } });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline install still works via cache-on-fetch */ });
  }

  // Runs only when sync is enabled and a token and context exist. Failures
  // are silent: the app is fully usable offline and the queue keeps changes.
  syncRunner.runSync().then((result) => {
    if (result?.pulled) refresh();
  }).catch(() => { /* local storage is always the source of truth */ });
}

boot();
