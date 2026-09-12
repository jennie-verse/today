// store.js — IndexedDB CRUD for tasks, localStorage settings, persist() request.
// No DOM rendering here.

import { DEFAULT_SETTINGS } from "./model.js";

const DB_NAME = "today-db";
const DB_VERSION = 2;
const SETTINGS_KEY = "today.settings.v1";

let dbPromise = null;
let dbFailed = false;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    let blocked = false;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbFailed = true;
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tasks")) {
        const store = db.createObjectStore("tasks", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("timelineEntries")) {
        const entries = db.createObjectStore("timelineEntries", { keyPath: "id" });
        for (const key of ["startDate", "endDate", "bucket", "runningKey"]) entries.createIndex(key, key);
      }
      if (!db.objectStoreNames.contains("timelineMeta")) db.createObjectStore("timelineMeta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("timelineConflicts")) {
        const conflicts = db.createObjectStore("timelineConflicts", { keyPath: "revisionId" });
        conflicts.createIndex("entryId", "id");
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other Today tabs, then reload to finish the update. Your data is kept."));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      dbFailed = false;
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      dbFailed = true;
      reject(request.error || new Error("Failed to open IndexedDB"));
    };
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

export function isDbFailed() {
  return dbFailed;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    if (req.transaction?.mode === "readwrite") {
      const transaction = req.transaction;
      transaction.oncomplete = () => resolve(req.result);
      transaction.onabort = () => reject(transaction.error || new Error("Task save was cancelled"));
      transaction.onerror = () => reject(transaction.error || new Error("Couldn't save tasks"));
    } else {
      req.onsuccess = () => resolve(req.result);
    }
    req.onerror = () => reject(req.error);
  });
}

// ---------- change hooks (journal.js and sync-runner.js listen here) ----------
// Mirrors loom's store.js: a local mutation notifies both hooks, but a pull
// from sync writes through withoutTaskHook() so an incoming remote change
// doesn't re-queue a Journal record or re-trigger tombstone bookkeeping.

let journalTaskChangeHook = null;
let syncTaskChangeHook = null;
let hookSuppressed = false;
let journalHookSuppressed = false;

export function setJournalTaskChangeHook(fn) {
  journalTaskChangeHook = typeof fn === "function" ? fn : null;
}
export function setSyncTaskChangeHook(fn) {
  syncTaskChangeHook = typeof fn === "function" ? fn : null;
}

export async function withoutTaskHook(fn) {
  hookSuppressed = true;
  try { return await fn(); }
  finally { hookSuppressed = false; }
}

// Suppresses only the Journal hook (sync still fires normally). Used when a
// mutation's Journal record is written by hand instead of by the generic
// next/previous-status inference — e.g. finalizing an Event/Note whose day
// ended still unmarked: the item is deleted locally (and must still tombstone
// for cross-device sync), but the Journal record it leaves behind is its
// last-known state, not a deletion tombstone.
export async function withoutJournalHook(fn) {
  journalHookSuppressed = true;
  try { return await fn(); }
  finally { journalHookSuppressed = false; }
}

export function notifyTaskChange(next, previous) {
  if (hookSuppressed) return;
  if (syncTaskChangeHook) { try { syncTaskChangeHook(next, previous); } catch { /* sync never blocks a local save */ } }
  if (!journalHookSuppressed && journalTaskChangeHook) { try { journalTaskChangeHook(next, previous); } catch { /* journal-only, must not break saves */ } }
}

// ---------- tasks ----------

export async function getAllTasks() {
  const db = await openDB();
  return (await reqToPromise(tx(db, "tasks", "readonly").getAll())) || [];
}

export async function getTaskById(id) {
  const db = await openDB();
  return reqToPromise(tx(db, "tasks", "readonly").get(id));
}

export async function putTask(task) {
  const db = await openDB();
  const previous = await getTaskById(task.id);
  await reqToPromise(tx(db, "tasks", "readwrite").put(task));
  notifyTaskChange(task, previous || null);
  return task;
}

// Used by reconciliation (bulk status change) and backup restore — skips the
// per-item change hook since these are bulk/background writes, matching
// loom's bulkPutBlocks (journalOnly bulk path).
// Resolve only after the whole transaction commits. In particular, a bad
// imported row must never leave an earlier clear/put partially applied.
export async function bulkPutTasks(tasks, { replace = false, notify = false } = {}) {
  const db = await openDB();
  let previous = [];
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("tasks", "readwrite");
    const taskStore = transaction.objectStore("tasks");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Couldn't save tasks"));
    transaction.onabort = () => reject(transaction.error || new Error("Task save was cancelled"));
    try {
      if (notify) {
        const request = taskStore.getAll();
        request.onsuccess = () => { previous = request.result || []; };
      }
      if (replace) taskStore.clear();
      for (const task of tasks) taskStore.put(task);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
  if (notify) {
    const byId = new Map(previous.map((task) => [task.id, task]));
    const incomingIds = new Set(tasks.map((task) => task.id));
    if (replace) {
      for (const task of previous) if (!incomingIds.has(task.id)) notifyTaskChange(null, task);
    }
    for (const task of tasks) notifyTaskChange(task, byId.get(task.id) || null);
  }
  return tasks;
}

export async function deleteTaskById(id) {
  const db = await openDB();
  const previous = await getTaskById(id);
  await reqToPromise(tx(db, "tasks", "readwrite").delete(id));
  if (previous) notifyTaskChange(null, previous);
  return previous || null;
}

export async function clearAllTasks() {
  const db = await openDB();
  const all = await getAllTasks();
  await reqToPromise(tx(db, "tasks", "readwrite").clear());
  for (const task of all) notifyTaskChange(null, task);
}

// ---------- settings (localStorage) ----------

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* best effort */ }
  return merged;
}

export function resetSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* best effort */ }
  return { ...DEFAULT_SETTINGS };
}
