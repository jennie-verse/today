import {
  DEFAULT_SETTINGS, MAX_SUBTASKS, TODAY_SLOTS,
  normalizeTask, subtaskProgress, todayKey,
  canPromoteToToday, reconcileToday, todayCandidates, somedayTasks, doneTasksByDate, todaySlotTasks, todayOverflowTasks,
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
  const { tasks, reverted } = reconcileToday(state.tasks, todayKey());
  if (!reverted.length) return;
  const toWrite = tasks.filter((t) => reverted.includes(t.id));
  await store.bulkPutTasks(toWrite);
  state.tasks = tasks;
}

async function refresh() {
  await loadTasks();
  await reconcile();
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
  const next = normalizeTask({
    ...task,
    status: done ? "done" : "someday",
    doneAt: done ? new Date().toISOString() : null,
    doneDate: done ? todayKey() : null,
  });
  await store.putTask(next);
  announce(`${next.title} ${done ? "completed" : "reopened"}`);
  await refresh();
}

async function promoteTask(task) {
  if (!canPromoteToToday(state.tasks, todayKey())) {
    toast("Today is full — remove one first");
    return;
  }
  const next = normalizeTask({ ...task, status: "today", todayDate: todayKey() });
  await store.putTask(next);
  toast(`Moved to Today`);
  await refresh();
}

async function deferTask(task) {
  const next = normalizeTask({ ...task, status: "someday", todayDate: null });
  await store.putTask(next);
  toast(`Moved to Someday`);
  await refresh();
}

async function deferAllOverflow() {
  const overflow = todayOverflowTasks(state.tasks, todayKey());
  if (!overflow.length) return;
  const ok = await confirmDialog({
    title: "Move all to Someday?",
    message: `${overflow.length} task${overflow.length === 1 ? "" : "s"} will move from Today to Someday.`,
    confirmLabel: "Move all",
  });
  if (!ok) return;
  for (const task of overflow) {
    await store.putTask(normalizeTask({ ...task, status: "someday", todayDate: null }));
  }
  toast(overflow.length === 1 ? "Moved to Someday" : `Moved ${overflow.length} tasks to Someday`);
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
  const limitHint = node("p", "hint", `Up to ${MAX_SUBTASKS} subtasks.`);
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
      const del = node("button", "", "✕");
      del.type = "button"; del.setAttribute("aria-label", `Remove: ${s.title}`);
      del.style.minWidth = "44px"; del.style.minHeight = "44px"; del.style.background = "none"; del.style.border = "0"; del.style.color = "var(--text-3)"; del.style.cursor = "pointer";
      del.addEventListener("click", async () => {
        current = normalizeTask({ ...current, subtasks: current.subtasks.filter((x) => x.id !== s.id) });
        await store.putTask(current);
        renderList();
      });
      row.append(check, node("span", "title", s.title), del);
      list.appendChild(row);
    });
    addBtn.disabled = current.subtasks.length >= MAX_SUBTASKS;
    addInput.disabled = addBtn.disabled;
    limitHint.textContent = current.subtasks.length >= MAX_SUBTASKS
      ? `Limit reached (${MAX_SUBTASKS}).`
      : `${current.subtasks.length}/${MAX_SUBTASKS} subtasks.`;
  }
  renderList();

  let composing = false;
  addInput.addEventListener("compositionstart", () => { composing = true; });
  addInput.addEventListener("compositionend", () => { composing = false; });
  async function addSubtask() {
    if (composing) return;
    const title = addInput.value.trim();
    if (!title || current.subtasks.length >= MAX_SUBTASKS) return;
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

function taskRow(task, { context }) {
  const wrap = node("div");
  const row = node("div", "task-row" + (task.status === "done" ? " done" : ""));
  const check = node("button", "check");
  check.type = "button";
  check.setAttribute("aria-label", task.status === "done" ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`);
  check.appendChild(node("span", "dot"));
  check.addEventListener("click", () => completeTask(task));

  const main = node("div", "main");
  main.appendChild(node("div", "title", task.title));
  const progress = subtaskProgress(task);
  if (progress.total) main.appendChild(node("div", "sub-progress", `${progress.done}/${progress.total} subtasks`));

  const actions = node("div", "actions");
  if (context !== "done") {
    actions.appendChild(actionButton("Edit subtasks", "✎", () => openSubtaskEditor(task)));
  }
  if (context === "today") {
    actions.appendChild(actionButton("Move to Someday", "↩", () => deferTask(task)));
  } else if (context === "someday") {
    actions.appendChild(actionButton("Move to Today", "→", () => promoteTask(task)));
  } else if (context === "done") {
    actions.appendChild(actionButton("Reopen", "↺", () => completeTask(task)));
  }
  actions.appendChild(actionButton("Delete", "🗑", () => deleteTask(task)));

  row.append(check, main, actions);
  wrap.appendChild(row);

  if (progress.total) {
    const list = node("div", "subtasks");
    task.subtasks.forEach((s) => list.appendChild(subtaskRow(task, s)));
    wrap.appendChild(list);
  }
  return wrap;
}

// ---------- render ----------

function render() {
  applyFont();
  const key = todayKey();

  const slots = todaySlotTasks(state.tasks, key);
  $("today-count").textContent = `${slots.length}/${TODAY_SLOTS}`;
  const slotsHost = $("today-slots");
  slotsHost.replaceChildren();
  for (let i = 0; i < TODAY_SLOTS; i += 1) {
    if (slots[i]) {
      const box = node("div", "slot");
      box.appendChild(taskRow(slots[i], { context: "today" }));
      slotsHost.appendChild(box);
    } else {
      const box = node("div", "slot empty", "Empty slot — add a task or move one from Someday");
      slotsHost.appendChild(box);
    }
  }

  const overflow = todayOverflowTasks(state.tasks, key);
  $("section-overflow").hidden = overflow.length === 0;
  $("overflow-count").textContent = `(${overflow.length})`;
  const overflowHost = $("overflow-list");
  overflowHost.replaceChildren();
  overflow.forEach((task) => {
    const box = node("div", "overflow-row");
    box.appendChild(taskRow(task, { context: "today" }));
    overflowHost.appendChild(box);
  });

  const candidates = todayCandidates(state.tasks, key);
  $("section-candidates").hidden = candidates.length === 0;
  $("candidates-count").textContent = `(${candidates.length})`;
  const candHost = $("candidates-list");
  candHost.replaceChildren();
  candidates.forEach((task) => {
    const row = node("div", "candidate-row");
    row.appendChild(node("div", "title", task.title));
    const btn = node("button", "", "Add to Today");
    btn.type = "button";
    btn.addEventListener("click", () => promoteTask(task));
    row.appendChild(btn);
    candHost.appendChild(row);
  });

  const someday = somedayTasks(state.tasks).sort((a, b) => (a.scheduledFor || "9999").localeCompare(b.scheduledFor || "9999") || a.title.localeCompare(b.title));
  $("someday-count").textContent = `(${someday.length})`;
  const somedayHost = $("someday-list");
  somedayHost.replaceChildren();
  if (!someday.length) somedayHost.appendChild(node("p", "empty-hint", "Nothing in Someday."));
  someday.forEach((task) => {
    const box = node("div", "someday-row");
    box.appendChild(taskRow(task, { context: "someday" }));
    somedayHost.appendChild(box);
  });

  const doneGroups = doneTasksByDate(state.tasks);
  $("done-count").textContent = `(${doneGroups.reduce((sum, [, list]) => sum + list.length, 0)})`;
  const doneHost = $("done-list");
  doneHost.replaceChildren();
  if (!doneGroups.length) doneHost.appendChild(node("p", "empty-hint", "Nothing done yet."));
  doneGroups.forEach(([date, tasks]) => {
    const group = node("div", "done-date-group");
    group.appendChild(node("h3", "", date));
    tasks.forEach((task) => group.appendChild(taskRow(task, { context: "done" })));
    doneHost.appendChild(group);
  });
}

// ---------- add bar ----------

let composingAdd = false;

function wireAddBar() {
  const input = $("add-input");
  const submit = $("add-submit");
  input.addEventListener("compositionstart", () => { composingAdd = true; });
  input.addEventListener("compositionend", () => { composingAdd = false; });

  async function submitAdd() {
    if (composingAdd) return;
    const raw = input.value;
    if (!raw.trim()) return;
    const parsed = parseNaturalLanguage(raw, { now: new Date() });
    try {
      const task = normalizeTask({
        title: parsed.title,
        status: "someday",
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
  const source = params.get("from") === "tide" ? "tide" : "manual";
  store.putTask(normalizeTask({ title: parsed.title, status: "someday", scheduledFor: parsed.scheduledFor, scheduledAtMinutes: parsed.scheduledAtMinutes, source }))
    .then(refresh)
    .then(() => toast(`Added to Someday from ${source === "tide" ? "Tide" : "link"}`));
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
  $("overflow-move-all").addEventListener("click", deferAllOverflow);

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
