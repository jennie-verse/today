# Test report — §8 stage 1 (type/order, Today 3-tier sort, ⋯ menu, Done scoped to today)

Date: 2026-09-02
Commits: `e4a5809` (feat), `db3f8da` (test/docs follow-up)

## Automatically verified

- `npm test` — 38/38 passing (26 pre-existing + 12 new/updated, including
  concurrently-added coverage for `taskType`/`todayTierGroups`). Covers:
  - `normalizeTask` defaults `type` to `"task"` and reads legacy records
    (no `type`/`order`) correctly.
  - `migrateOrder` assigns `order` by ascending `createdAt`, numbered
    separately per status bucket (today/someday/done), and is a no-op for
    records that already have an `order`.
  - `sortTodayTiers`/`todayTierGroups`: Event (by `scheduledAtMinutes`, no
    value sorts last) → Task (by `order`) → Note (by `order`).
  - `autoPromoteEvents`: only a Someday **event** scheduled for today is
    promoted; tasks and notes are never auto-promoted.
  - `todayDoneTasks`/`staleDoneTasks`: Done today only, sorted by `doneAt`
    ascending; everything else is "stale" and gets cleaned up on boot.
- `npm run test:syntax` — passes for every `src/*.js` and `sw.js` (Node
  `--check` on each file).
- Console errors: not verifiable in a live browser during this session (no
  headed browser available). Checked instead by (a) `node --check` syntax
  validation on every changed file, (b) tracing every new code path
  (`migrate`, `reconcile`, `cleanupOldDone`, `moveTask`, `openRowMenu`,
  `sortTodayTiers` rendering) by hand against `state.tasks` shapes the test
  suite exercises, and (c) confirming the GitHub Actions `Test` and
  `Test and deploy GitHub Pages` workflows both succeeded on push (run ids
  under commit `db3f8da`).
- `sw.js` `VERSION` and `src/version.js` `APP_BUILD` both bumped to
  `2026.09.02-typeorder1` and kept in sync.
- IndexedDB schema version left untouched (`DB_VERSION` in `src/store.js`
  unchanged) — `type`/`order` are additive fields only, no `onupgradeneeded`
  changes needed.
- Journal ordering double-checked by reading `src/journal.js`/
  `src/journal-record.js`: `store.putTask`'s `notifyTaskChange` hook (which
  queues the Journal record) fires synchronously inside `completeTask` at
  the moment a task is marked done — i.e. every existing Done record was
  already sent to Journal well before `cleanupOldDone` can ever run on a
  later boot. `cleanupOldDone` deletes stale local Done records through
  `store.withoutTaskHook`, which suppresses `notifyTaskChange` for that
  delete — so it does **not** enqueue a Journal tombstone, and the record
  stays visible in Daybook.

## Pending — 사용자 확인 필요

다음은 자동화로 확인할 수 없어 Jennifer가 실제 기기에서 직접 확인해야 합니다.

- **기존 데이터로 열어보기**: 이미 쌓여 있던 today 앱 데이터(마이그레이션 전
  `type`/`order` 없는 레코드)로 앱을 열었을 때 아무 항목도 사라지거나 순서가
  이상하게 뒤바뀌지 않는지 확인.
- **⋯ 메뉴 터치 영역**: iPhone 실기기에서 각 행의 "⋯" 버튼과 메뉴 안의
  Edit/Move up/Move down/Move to Someday/Delete 등 항목들이 44×44pt 이상으로
  누르기 편한지 확인.
- **한글 입력(IME) Enter 동작**: 한글 조합 중 Enter를 눌러도 문장이 잘리거나
  잘못 제출되지 않는지, 특히 Edit 시트와 Add bar에서 확인.
- **글꼴 크기 6단계 전부**: Settings에서 폰트 크기를 6단계 모두 바꿔가며
  Today 3-tier 구분선, ⋯ 메뉴 시트, note 대시(—)/event 시간 배지가 레이아웃이
  깨지지 않는지 확인.
- **세로/가로 모드**: iPhone과 iPad에서 각각 portrait/landscape로 Today,
  Someday, Done 섹션이 정상적으로 보이는지 확인.
- **"지난 Done 항목은 Today 기기에서 사라지지만 Daybook에는 남는다"**: 실제
  Journal이 켜진 상태에서, 어제 이전에 완료한 항목이 (1) today 앱을 다시 열면
  Done 목록에서 사라지고 (2) Daybook에서는 계속 보이는지 직접 확인. 단,
  **Daybook 쪽 표시는 아직 stage 4에서 다듬을 예정**이라 지금은 Journal에
  기록만 남아 있고 Daybook UI가 그 기록을 얼마나 보기 좋게 보여주는지는
  별도로 검증이 필요합니다.
- **동기화(Sync) 중인 다른 기기와의 상호작용**: 한 기기에서 순서를 바꾸거나
  ⋯ 메뉴로 이동했을 때 Sync가 켜진 다른 기기에도 올바르게 반영되는지(이번
  단계는 Sync 자체를 건드리지 않았지만, `order` 필드가 새로 동기화 대상에
  포함되므로 실기기 교차 확인 권장).
