// store.js — IndexedDB CRUD for tasks, localStorage settings, persist() request.
// No DOM rendering here.

import { DEFAULT_SETTINGS } from "./model.js";

const DB_NAME = "today-db";
const DB_VERSION = 1;
const SETTINGS_KEY = "today.settings.v1";

let dbPromise = null;
let dbFailed = false;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
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
    };
    request.onsuccess = () => {
      dbFailed = false;
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      dbFailed = true;
      reject(request.error || new Error("Failed to open IndexedDB"));
    };
  });
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
    req.onsuccess = () => resolve(req.result);
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

function notifyTaskChange(next, previous) {
  if (hookSuppressed) return;
  if (syncTaskChangeHook) { try { syncTaskChangeHook(next, previous); } catch { /* sync never blocks a local save */ } }
  if (journalTaskChangeHook) { try { journalTaskChangeHook(next, previous); } catch { /* journal-only, must not break saves */ } }
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
export async function bulkPutTasks(tasks) {
  const db = await openDB();
  const store = tx(db, "tasks", "readwrite");
  await Promise.all(tasks.map((task) => reqToPromise(store.put(task))));
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
