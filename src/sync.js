/* ==========================================================================
   sync.js — webapp-data(비공개 저장소)와 주고받는 부분.

   loom의 sync.js와 같은 방식입니다(새 구조를 만들지 않음). 다루는 것은
   기기 간 할 일 동기화 하나뿐입니다 — today는 이벤트(B층)·원격 백업(C층)을
   요청받지 않았습니다.

     today/data.<ctx>.json   기기 간 동기화 (설정 업로드 + 할 일 전체)

   동기화는 기본으로 꺼져 있습니다. 꺼진 상태에서도 앱은 완전히 동작해야 하고,
   로컬 저장이 언제나 먼저입니다. Journal은 이 파일의 토큰·컨텍스트만 쓰고
   isEnabled()/isReady()와는 무관하게 독립적으로 켜고 끕니다(기존 loom과 동일).

   공용 모듈은 필요할 때만 동적으로 부릅니다 — 실패해도 앱은 그대로 뜹니다.
   ========================================================================== */

let sharedPromise = null;

async function api() {
  if (!sharedPromise) {
    sharedPromise = import("../../shared/v1/sync.js").catch((cause) => {
      sharedPromise = null;
      const error = new Error("The shared sync module could not be loaded.");
      error.type = "network";
      error.cause = cause;
      throw error;
    });
  }
  return sharedPromise;
}

const NAMESPACE = "today";
const HOSTNAME = globalThis.location?.hostname || "";
const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io") ? HOSTNAME.slice(0, -".github.io".length) : "",
  repo: "webapp-data",
  branch: "main",
});

export const KEYS = Object.freeze({
  token: "sync.token.v1",
  enabled: "today.syncEnabled",
  lastSyncAt: "today.lastSyncAt",
  taskTombstones: "today.taskTombstones.v1",
});

// GitHub Contents API는 1MB를 넘으면 읽기가 느려지고 커밋도 무거워집니다.
const MAX_FILE_BYTES = 1000000;

function readItem(key, fallback = "") {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
  catch { return fallback; }
}
function writeItem(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function removeItem(key) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}
function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch { return fallback; }
}

export function getToken() { return readItem(KEYS.token, ""); }
export function saveToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return false;
  return writeItem(KEYS.token, trimmed);
}
export function clearToken() { removeItem(KEYS.token); }
export function tokenHint() {
  const token = getToken();
  return token ? `••••${token.slice(-4)}` : "";
}

export function isEnabled() { return readItem(KEYS.enabled) === "1"; }
export function setEnabled(enabled) { writeItem(KEYS.enabled, enabled ? "1" : "0"); }

const CONTEXT_KEY = `${NAMESPACE}.syncContextId`;
const CONTEXT_LABEL_KEY = `${NAMESPACE}.syncContextLabel`;

export function getContextId() { return readItem(CONTEXT_KEY, ""); }
export function getContextLabel() { return readItem(CONTEXT_LABEL_KEY, ""); }
export function setContextLabel(label) { writeItem(CONTEXT_LABEL_KEY, String(label || "").trim()); }

// The id is created once and never changes — it goes into remote file names.
export async function ensureContext(preferredName) {
  const Shared = await api();
  return Shared.ensureContextId(NAMESPACE, () => String(preferredName || "").trim());
}

export function getLastSyncAt() {
  return Number(readItem(KEYS.lastSyncAt, "0")) || 0;
}

// 동기화가 실제로 동작할 수 있는 상태인지. 셋 중 하나라도 없으면 조용히 쉽니다.
// (Journal은 이 값과 무관하게 getToken()/getContextId()만 직접 봅니다 — loom과 동일)
export function isReady() {
  return Boolean(isEnabled() && getToken() && getContextId());
}

export function config() {
  return { ...REPO, token: getToken() };
}

export function describeError(error) {
  if (!error) return "Sync failed.";
  if (error.type === "auth") return "Token may be expired or lacks permission.";
  if (error.type === "network") return "Network unavailable. Changes are queued.";
  if (error.type === "notfound") return "The repository path was not found.";
  if (error.type === "conflict") return "Another device wrote first. Try again.";
  if (error.type === "toolarge") return "The file is too large to sync. Export a backup file instead.";
  return "Sync failed. Check the token and repository access.";
}

function tooLarge(message) {
  const error = new Error(message);
  error.type = "toolarge";
  return error;
}

/* ── 병합: 같은 id는 updatedAt이 최신인 쪽이 이깁니다 (loom과 동일 규칙) ── */

const EPOCH = "1970-01-01T00:00:00.000Z";

function stamp(item) {
  return String(item && item.updatedAt ? item.updatedAt : EPOCH);
}

function tombstoneStamp(item) {
  return String(item && item.deletedAt ? item.deletedAt : EPOCH);
}

function mergeById(base, incoming) {
  const merged = new Map();
  (Array.isArray(base) ? base : []).forEach((item) => {
    if (item && typeof item.id === "string") merged.set(item.id, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((item) => {
    if (!item || typeof item.id !== "string") return;
    const previous = merged.get(item.id);
    if (!previous || stamp(item) >= stamp(previous)) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function normalizeTombstones(value) {
  const merged = new Map();
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (!item || typeof item.id !== "string" || !item.id || Number.isNaN(Date.parse(item.deletedAt))) return;
    const previous = merged.get(item.id);
    if (!previous || tombstoneStamp(item) > tombstoneStamp(previous)) {
      merged.set(item.id, { id: item.id, deletedAt: item.deletedAt });
    }
  });
  return [...merged.values()];
}

function mergeTombstonesById(base, incoming) {
  return normalizeTombstones([...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

export function getTaskTombstones() {
  return normalizeTombstones(parseJson(readItem(KEYS.taskTombstones, "[]"), []));
}

function saveTaskTombstones(tombstones) {
  const normalized = normalizeTombstones(tombstones);
  writeItem(KEYS.taskTombstones, JSON.stringify(normalized));
  return normalized;
}

// 로컬에서 할 일을 지울 때 부릅니다. 다른 기기가 다시 살려 내지 않도록
// 삭제 사실 자체를 동기화합니다(loom의 blockTombstones와 동일).
export function recordTaskDeletion(task) {
  if (!task || typeof task.id !== "string" || !task.id) return null;
  const tombstone = { id: task.id, deletedAt: new Date().toISOString() };
  saveTaskTombstones(mergeTombstonesById(getTaskTombstones(), [tombstone]));
  return tombstone;
}

export function clearTaskTombstone(id) {
  if (!id) return;
  saveTaskTombstones(getTaskTombstones().filter((item) => item.id !== id));
}

export function mergeTaskTombstones(incoming) {
  return saveTaskTombstones(mergeTombstonesById(getTaskTombstones(), incoming));
}

// 삭제 이후에 다시 수정된 항목(다른 기기에서 "되살리기")은 tombstone보다
// 최신이면 살아남습니다 — loom의 applyBlockTombstones와 동일한 규칙.
export function applyTaskTombstones(items, tombstones) {
  const deleted = new Map(normalizeTombstones(tombstones).map((item) => [item.id, item]));
  return (Array.isArray(items) ? items : []).filter((item) => {
    const tombstone = deleted.get(item && item.id);
    return !tombstone || tombstoneStamp(tombstone) < stamp(item);
  });
}

/* ── 기기 간 동기화 ────────────────────────────────────────────────────── */

function dataPath(contextId) {
  return `${NAMESPACE}/data.${contextId}.json`;
}

// 이 기기의 할 일 전체를 한 파일로 올립니다. 기기마다 파일이 분리됩니다.
//
// 올리기는 tombstone 없는 기록을 실수로 줄이지 않습니다 — 원격 항목과
// 합집합을 만들어 씁니다. 화면 상태가 아직 안 채워졌거나 IndexedDB가 잠깐
// 안 열리는 등 어떤 이유로든 빈 목록이 들어와도 원격 기록이 지워지지
// 않게 하기 위한 안전장치입니다(focus/loom에서 실제로 겪은 사고).
//
// settings는 올리기만 하고 받을 때 적용하지 않습니다 — 글자 크기 등은
// 기기마다 다른 값이 맞습니다. 백업에서 되돌릴 때를 위해 담아만 둡니다.
export async function pushData({ settings, tasks }) {
  const Shared = await api();
  if (!isReady()) return false;
  const cfg = config();
  const contextId = getContextId();
  const path = dataPath(contextId);

  const existing = await Shared.readFile(cfg, path);
  let previousTasks = [];
  let previousTombstones = [];
  if (existing.exists) {
    const previous = parseJson(existing.content, null);
    if (previous && previous.data) {
      if (Array.isArray(previous.data.tasks)) previousTasks = previous.data.tasks;
      if (Array.isArray(previous.data.taskTombstones)) previousTombstones = previous.data.taskTombstones;
    }
  }

  const taskTombstones = mergeTombstonesById(previousTombstones, getTaskTombstones());
  const mergedTasks = applyTaskTombstones(mergeById(previousTasks, tasks), taskTombstones);

  const body = `${JSON.stringify({
    v: 1,
    app: NAMESPACE,
    context: contextId,
    updatedAt: new Date().toISOString(),
    data: { settings, tasks: mergedTasks, taskTombstones },
  }, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge("The today data file is too large to sync.");
  }

  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `today: update ${path}`,
  });
  writeItem(KEYS.lastSyncAt, String(Date.now()));
  return true;
}

// 모든 기기의 파일을 읽어 할 일을 합칩니다. 같은 id는 updatedAt 최신이 이깁니다.
export async function pullData() {
  const Shared = await api();
  if (!isReady()) return null;
  const cfg = config();
  const entries = await Shared.listDir(cfg, NAMESPACE);
  const files = entries.filter((entry) => (
    entry.type === "file" && /^data\.[a-z0-9-]+\.json$/i.test(entry.name)
  ));
  if (files.length === 0) return { tasks: [], taskTombstones: getTaskTombstones() };

  let tasks = [];
  let taskTombstones = [];
  for (const entry of files) {
    const file = await Shared.readFile(cfg, entry.path);
    if (!file.exists) continue;
    const payload = parseJson(file.content, null);
    if (!payload || !payload.data) continue;
    tasks = mergeById(tasks, payload.data.tasks);
    taskTombstones = mergeTombstonesById(taskTombstones, payload.data.taskTombstones);
  }
  taskTombstones = mergeTaskTombstones(taskTombstones);
  tasks = applyTaskTombstones(tasks, taskTombstones);
  writeItem(KEYS.lastSyncAt, String(Date.now()));
  return { tasks, taskTombstones };
}
