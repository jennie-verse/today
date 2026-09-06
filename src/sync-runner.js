/* sync-runner.js — 언제 동기화를 돌릴지, 무엇을 올릴지 정하는 곳.
   실제 GitHub 통신은 sync.js가 합니다. loom의 sync-runner.js와 같은 순서입니다.

   순서를 어기면 데이터가 사라집니다(2026-08-09 focus에서 실제로 겪은 사고).

     1. 받아오기 (pullData)
     2. 합치기  — 로컬에 없거나 오래된 것만 넣습니다. **지우지 않습니다.**
     3. 올리기  — 올릴 목록은 **저장소에서 새로 읽습니다.** 화면 상태를 쓰지 않습니다.

   올리기가 받아오기보다 먼저 돌면, 아직 아무것도 못 받은 빈 상태가 원격을 덮어씁니다.
   today는 이벤트(B층)를 요청받지 않았으므로 그 단계는 없습니다. */

import * as store from "./store.js";
import * as sync from "./sync.js";

// 공용 모듈과 같은 4초 디바운스입니다. 항목을 연달아 고칠 때 요청이 쌓이지 않게 합니다.
const PUSH_DEBOUNCE_MS = 4000;
const EPOCH = "1970-01-01T00:00:00.000Z";

let pushTimer = null;
let inFlight = null;
let listener = null;

function stamp(item) {
  return String(item && item.updatedAt ? item.updatedAt : EPOCH);
}

function notify(state, detail) {
  if (listener) {
    try { listener(state, detail); } catch { /* UI 갱신 실패가 동기화를 막지 않습니다. */ }
  }
}

/** 설정 화면이 상태 줄을 갱신할 수 있도록 등록합니다. */
export function onSyncState(fn) {
  listener = typeof fn === "function" ? fn : null;
}

/** 앱 시작 시 한 번 부릅니다. 동기화가 꺼져 있어도 tombstone은 기록해 둡니다
    — 나중에 켰을 때 그동안 지운 것이 되살아나지 않게 하기 위해서입니다. */
export function attach() {
  store.setSyncTaskChangeHook((next, previous) => {
    if (next) sync.clearTaskTombstone(next.id);
    else if (previous) sync.recordTaskDeletion(previous);
    schedulePush();
  });
}

export function schedulePush() {
  if (!sync.isReady()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { runSync().catch(() => {}); }, PUSH_DEBOUNCE_MS);
}

/** @returns {Promise<{skipped?:boolean, pulled?:number, error?:Error}>} */
export function runSync() {
  if (inFlight) return inFlight;
  inFlight = runSyncOnce().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSyncOnce() {
  if (!sync.isReady()) return { skipped: true };
  clearTimeout(pushTimer);
  notify("syncing");

  try {
    // 1·2. 받아오기 → 합치기
    const remote = await sync.pullData();
    let pulled = 0;
    if (remote) {
      const localTasks = await store.getAllTasks();
      const byId = new Map(localTasks.map((t) => [t.id, t]));
      // 받은 것을 다시 Journal·동기화 큐로 되돌리지 않도록 훅을 잠시 끕니다.
      await store.withoutTaskHook(async () => {
        const deletedIds = (remote.taskTombstones || [])
          .filter((item) => {
            const current = byId.get(item.id);
            return current && String(item.deletedAt) >= stamp(current);
          })
          .map((item) => item.id);
        for (const id of deletedIds) {
          await store.deleteTaskById(id);
          byId.delete(id);
        }
        for (const task of remote.tasks) {
          const current = byId.get(task.id);
          if (!current || stamp(task) > stamp(current)) {
            await store.putTask(task);
            pulled += 1;
          }
        }
      });
    }

    // 3. 올리기 — 저장소에서 새로 읽습니다. 화면 상태는 쓰지 않습니다.
    const tasks = await store.getAllTasks();
    await sync.pushData({ settings: store.getSettings(), tasks });

    notify("idle", { pulled });
    return { pulled };
  } catch (error) {
    notify("error", { error });
    return { error };
  }
}
