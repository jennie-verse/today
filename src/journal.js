import * as store from "./store.js";
import * as sync from "./sync.js";
import { taskActivityRecord, taskToJournalRecord, journalDateFor, localIso } from "./journal-record.js";
import { inferTaskAction } from "./model.js";

const ENABLED_KEY = "today.journalEnabled.v1";
const CONTENT_KEY = "today.journalContent.v1";
const SUBTASK_TEXT_KEY = "today.journalSubtaskText.v1";
const ACTIVITY_KEY = "today.journalActivity.v1";
const HOSTNAME = globalThis.location?.hostname || "";
const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io") ? HOSTNAME.slice(0, -".github.io".length) : "",
  repo: "webapp-data",
  branch: "main",
});

let clientPromise = null;
let listener = null;
let lastState = { status: "not reported", pendingCount: 0, errorCode: "" };

function readItem(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function writeItem(key, value) { try { localStorage.setItem(key, value); } catch { /* best effort */ } }

function publish(patch) {
  lastState = { ...lastState, ...patch };
  if (listener) { try { listener({ enabled: isJournalEnabled(), ...lastState }); } catch { /* UI only */ } }
}

function safeCode(error, fallback) {
  return typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code) ? error.code : fallback;
}

export function isJournalEnabled() { return readItem(ENABLED_KEY) === "1"; }
export function setJournalEnabled(enabled) { writeItem(ENABLED_KEY, enabled ? "1" : "0"); }

export function isJournalContentEnabled() { return readItem(CONTENT_KEY) !== "0"; }
export async function setJournalContentEnabled(enabled) {
  writeItem(CONTENT_KEY, enabled ? "1" : "0");
  const client = await getClient();
  if (client && !enabled) await client.transformPending((record) => ({ ...withoutJournalContent(record), updatedAt: localIso() }));
  await reportJournalStatus();
}
export function withoutJournalContent(record) {
  const data = { ...record.data, contentIncluded: false };
  delete data.subtasks;
  return { ...record, title: "Today task", data };
}

// Off by default: subtask titles can be sensitive even when the task title
// itself is shared, so they need an explicit second opt-in.
export function isSubtaskTextEnabled() { return readItem(SUBTASK_TEXT_KEY) === "1"; }
export function setSubtaskTextEnabled(enabled) { writeItem(SUBTASK_TEXT_KEY, enabled ? "1" : "0"); }

export function getJournalState() { return { enabled: isJournalEnabled(), ...lastState }; }
export function onJournalState(fn) {
  listener = typeof fn === "function" ? fn : null;
  if (listener) publish({});
  return () => { if (listener === fn) listener = null; };
}

async function getClient() {
  if (clientPromise) {
    const existing = await clientPromise;
    if (existing) return existing;
    clientPromise = null;
  }
  clientPromise = (async () => {
    const context = sync.getContextId();
    if (!context) return null;
    const module = await import("../../shared/v2/journal.js");
    return module.createJournalClient({
      app: "today",
      context,
      namespace: "today-journal",
      isEnabled: isJournalEnabled,
      resolveConfig: async () => {
        const token = sync.getToken();
        if (!token) throw Object.assign(new Error("Journal authentication unavailable"), { type: "auth", code: "AUTH" });
        return { ...REPO, token };
      },
      onState: (state) => publish({ status: state.status, pendingCount: state.pendingCount, errorCode: state.errorCode || "" }),
    });
  })().catch(() => null);
  return clientPromise;
}

function readActivity() { try { const value = JSON.parse(readItem(ACTIVITY_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
export function exportActivityLedger() { return Object.values(readActivity()); }
export function replaceActivityLedger(rows, { merge = false } = {}) {
  const entries = merge ? readActivity() : {};
  const cutoff = Date.now() - 90 * 86400000;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || typeof row.taskId !== "string" || !row.taskId) continue;
    if (!Array.isArray(row.actions) || !Number.isFinite(Date.parse(row.firstAt)) || !Number.isFinite(Date.parse(row.lastAt)) || Date.parse(row.lastAt) < cutoff) continue;
    const key = `${row.date}:${row.taskId}`;
    if (!entries[key] || Date.parse(entries[key].lastAt) <= Date.parse(row.lastAt)) {
      entries[key] = {
        date: row.date, taskId: row.taskId, title: String(row.title || ""),
        actions: [...new Set(row.actions.filter((a) => typeof a === "string"))],
        firstAt: row.firstAt, lastAt: row.lastAt,
        ...(["today", "someday"].includes(row.destination) ? { destination: row.destination } : {}),
        done: row.done === true,
        ...(["today", "someday", "done", "deleted"].includes(row.finalStatus) ? { finalStatus: row.finalStatus } : {}),
      };
    }
  }
  writeItem(ACTIVITY_KEY, JSON.stringify(entries));
  return entries;
}
export function clearActivityLedger() { try { localStorage.removeItem(ACTIVITY_KEY); return true; } catch { return false; } }

function recordLocalActivity(next, previous) {
  const task = next || previous;
  const at = localIso();
  const date = at.slice(0, 10);
  const key = `${date}:${task.id}`;
  const entries = readActivity();
  const current = entries[key];
  const action = inferTaskAction(next, previous);
  const destination = [next?.status, previous?.status, current?.destination].find((value) => value === "today" || value === "someday");
  const finalStatus = next?.status || "deleted";
  entries[key] = {
    date, taskId: task.id, title: String(task.title || ""),
    actions: [...new Set([...(current?.actions || []), action])],
    firstAt: current?.firstAt || at, lastAt: at,
    ...(destination ? { destination } : {}),
    done: next?.status === "done",
    finalStatus,
  };
  const cutoff = Date.now() - 90 * 86400000;
  Object.keys(entries).forEach((id) => { if (Date.parse(entries[id].lastAt) < cutoff) delete entries[id]; });
  writeItem(ACTIVITY_KEY, JSON.stringify(entries));
  return entries[key];
}

async function queueTaskChange(next, previous) {
  const source = next || previous;
  if (!source) return;
  const entry = recordLocalActivity(next, previous);
  if (!isJournalEnabled()) return;
  const client = await getClient();
  if (!client) { publish({ status: "error", errorCode: "MODULE_UNAVAILABLE" }); return; }
  const includeContent = isJournalContentEnabled();
  const includeSubtaskText = isSubtaskTextEnabled();
  try {
    const module = await import("../../shared/v2/journal.js");
    if (!module.JOURNAL_KINDS?.today?.includes("task-activity")) { publish({ status: "error", errorCode: "CONTRACT_STALE" }); return; }

    if (!next) {
      const previousDay = journalDateFor(previous);
      if (previousDay) {
        await client.enqueue(taskToJournalRecord(previous, { deleted: true, updatedAt: new Date(), includeContent, previousDay }), { date: previousDay });
      }
      await client.enqueue(taskActivityRecord(entry, previous, { includeContent }), { date: entry.date });
      return;
    }

    const nextDay = journalDateFor(next);
    const previousDay = previous ? journalDateFor(previous) : null;
    if (nextDay) {
      await client.enqueue(taskToJournalRecord(next, { includeContent, includeSubtaskText }), {
        date: nextDay,
        previousDate: previousDay && previousDay !== nextDay ? previousDay : undefined,
      });
    } else if (previousDay) {
      // The task left every calendar day it used to occupy (e.g. Today -> Someday
      // without a matching scheduledFor) — tombstone its old projection.
      await client.enqueue(taskToJournalRecord(previous, { deleted: true, updatedAt: new Date(), includeContent, previousDay }), { date: previousDay });
    }
    await client.enqueue(taskActivityRecord(entry, next, { includeContent }), { date: entry.date });
  } catch (error) {
    publish({ status: "error", errorCode: safeCode(error, "QUEUE_FAILED") });
  }
}

export function attachJournal() {
  store.setJournalTaskChangeHook((next, previous) => {
    queueTaskChange(next, previous).catch(() => publish({ status: "error", errorCode: "QUEUE_FAILED" }));
  });
}

export async function toggleJournal(enabled, preferredName = "") {
  if (enabled) {
    if (!sync.getToken()) return { ok: false, reason: "token" };
    if (!sync.getContextId()) await sync.ensureContext(preferredName);
    if (!sync.getContextId()) return { ok: false, reason: "context" };
  }
  clientPromise = null;
  setJournalEnabled(enabled);
  publish({ status: enabled ? "ready" : "disabled", errorCode: "" });
  await reportJournalStatus({ enabledAt: enabled ? localIso() : undefined });
  return { ok: true };
}

export async function reportJournalStatus(extra = {}) {
  const client = await getClient();
  if (!client) return false;
  try {
    await client.reportStatus({ journalEnabled: isJournalEnabled(), contentIncluded: isJournalContentEnabled(), ...extra });
    return true;
  } catch (error) {
    publish({ status: "error", errorCode: safeCode(error, "STATUS_FAILED") });
    return false;
  }
}

export async function refreshJournalState() {
  const client = await getClient();
  if (client) { try { publish({ pendingCount: await client.pendingCount() }); } catch { /* retain safe count */ } }
  return getJournalState();
}
