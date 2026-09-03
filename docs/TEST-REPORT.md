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

# §8 stage 2 — add-bar kind chips, Note textarea, 종류 바꾸기, Someday order-sort/filter/clamp, Turn into tasks

Date: 2026-09-03

## 결정: Task → Note 종류 바꾸기의 하위 항목 처리

Note에는 하위 항목 개념이 없으므로, Task를 Note로 바꿀 때 하위 항목이 있으면 **확인창을 먼저 띄우고("하위 항목
N개가 사라집니다"), 확인하면 버린다**를 선택했다(변환을 아예 막는 대신). 이유:

- 변환을 막으면 사용자가 먼저 하위 항목을 전부 지워야 하는 추가 왕복이 생긴다 — brain dump의 마찰을 줄이자는
  이번 단계의 목표와 어긋난다.
- 하위 항목은 Task 상태에서 이미 `⋯` → Edit subtasks로 볼 수 있었으므로, 확인창에 개수를 명시하면 예상 밖의
  데이터 손실은 아니다.
- Note → Task는 반대로 하위 항목을 새로 만들어내지 않는다(빈 배열로 시작) — 원래 없던 데이터를 지어내지
  않는다는 원칙과 일치.

구현: `src/model.js`의 `switchTaskKind(task, kind)`가 실제 변환(및 Note로 갈 때 `subtasks: []`)을 맡고,
확인창은 호출부인 `src/app.js`의 `changeTaskKind()`가 담당한다.

## 결정: Event로 바꿀 때 시각 처리

Task/Note → Event로 바꿀 때 시각을 강제로 입력받거나 기본값을 채우지 않고, `scheduledAtMinutes`를 그대로
(비어 있으면 비어 있는 채로) 둔다. 가장 단순하고 안전한 선택지: 사용자가 원하면 이후 Edit에서 자연어로
시각을 넣은 문장으로 고치면 된다. Today 3-tier 정렬에서 시각 없는 Event는 이미 "값 없으면 뒤로" 규칙이
있으므로(stage 1), 시각 없는 Event가 생겨도 화면이 깨지지 않는다.

## Automatically verified

- `npm test` — 46/46 passing (기존 38개 + 새로 추가한 8개: `somedayFiltered`
  order-sort/filter 2개, `switchTaskKind` kind-switching 1개, `splitNoteLines`
  1개, `tasksFromNoteLines` order 연속성 2개, `source`에 `"clip"` 허용 1개,
  `taskToJournalRecord`의 `data.type` 1개).
- `npm run test:syntax` — `src/*.js`·`sw.js` 전부 `node --check` 통과.
- 콘솔 오류: 이번 세션도 헤드리스 환경이라 실제 브라우저에서 직접 확인하지
  못했다. 대신 (a) 모든 변경 파일 `node --check` 문법 검사, (b) 새 코드 경로
  (`wireAddKindChips`/`applyAddKindUI`, `renderSomedayFilterChips`,
  `changeTaskKind`/`openKindSheet`, `openTurnIntoTasksSheet`)를 테스트가
  이미 검증한 `state.tasks` 모양을 기준으로 손으로 추적, (c) 배포 후
  GitHub Actions `Test`/`Test and deploy GitHub Pages` 성공 확인으로 대체.
- `sw.js` `VERSION`과 `src/version.js` `APP_BUILD`를 `2026.09.03-braindump2`로
  함께 올림 — 새로 추가된 파일은 없으므로 `APP_SHELL` 캐시 목록은 그대로 둠.
- IndexedDB 스키마 버전(`DB_VERSION`) 변경 없음 — 이번 단계도 필드 추가만.
- `innerHTML`을 쓰는 새 코드는 없음(`textContent`/`node()` 헬퍼만 사용) —
  grep으로 재확인.

## Pending — 사용자 확인 필요

- **종류 칩 선택이 재시작 후에도 유지되는지**: Task/Note/Event 중 하나를
  고르고 앱을 새로고침했을 때 마지막 선택이 그대로 켜져 있는지.
- **Note 여러 줄 입력의 저장·재로드**: 여러 줄(빈 줄 포함)을 넣고 저장한 뒤
  Someday에서 다시 열었을 때(펼침) 줄바꿈이 그대로인지.
- **Turn into tasks가 올바른 순서로 Task를 만드는지**: 원본 노트 바로 다음
  순서에 새 Task들이 들어가고, 기존 Someday 항목들과 순서가 뒤섞이지
  않는지(같은 `order` 값을 가진 기존 항목이 있을 때의 동작 포함).
- **종류 바꾸기의 하위 항목 처리**: Task→Note 확인창 문구·동작이 실제
  기기에서 기대대로 뜨는지, 확인 후 정말 하위 항목이 사라지는지.
- **필터 칩 선택 유지**: Someday 필터(All/Tasks/Notes)를 바꾸고 앱을 다시
  열었을 때 선택이 유지되는지.
- **4줄 클램프 펼치기/접기 터치 영역**: 긴 Note 카드를 탭해서 펼치고 다시
  탭해서 접는 동작이 44×44pt 이상의 편한 터치 영역으로 동작하는지, 글자
  크기 6단계 전부에서 레이아웃이 깨지지 않는지.
- **Note textarea에서 한글 IME**: 한글 조합 중 Enter를 눌러도 줄바꿈이
  잘못 끊기거나 조기 제출되지 않는지 실기기에서 확인.
