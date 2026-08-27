# Today 테스트 리포트

검토일: 2026-08-26
계획서: `Plan/webapp-benchmark/Productivity_App_Benchmark_Plan_2026-08-26.md` A-1 항목.

## 자동 테스트

`node --test tests/*.test.mjs` — **19/19 통과**, `npm run test:syntax` 전체 통과.

- `model.js` — 제목 clamp, 상태 기본값(someday), 하위 단계 5개 상한, todayDate/doneAt/doneDate가 해당 status에서만 채워짐, 3칸 규칙(다른 날짜는 안 셈), `reconcileToday`가 어제 남은 Today 항목만 조용히 Someday로 되돌림, 오늘 후보 산출, Done 날짜별 그룹(최근 날짜 우선), 활동 유형 추론(created/deleted/completed/reopened/promoted/deferred/edited).
- `nlp-date.js` — 오늘/내일/모레, 바른 Korean bare weekday(다음 발생일, 오늘 제외), 다음주 X요일(항상 다음 주로), N월 N일(유효하지 않은 날짜는 인식 안 함), 오전/오후 H시(분)·HH:MM, 영문 today/tomorrow/next X/Nam·pm, **매주·every 접두어가 있으면 인식하지 않고 원문 그대로 유지**, 인식 실패 시 원문 유지·오류 없음.
- `journal-record.js` — `journalDateFor`는 Today(todayDate)와 Done(doneDate)에서만 값을 돌려줌(Someday는 null), 기본은 하위 단계 개수만 전송하고 `Include subtask text`가 켜졌을 때만 제목 전송, 전체 콘텐츠 토글이 꺼지면 하위 단계 텍스트도 함께 숨겨짐, 순수 Someday 항목은 `task` 레코드로 만들 수 없음(호출 시 오류), `task-activity`는 `taskId:activityDate`로 키가 만들어짐.

## 실제 브라우저 검증 (2026-08-26, 이 세션에서 실행)

데스크톱 자동화가 불가능한 실기기 터치·회전과 달리, 아래 항목은 헤드리스 Chrome + Chrome DevTools Protocol로 실제 페이지를 띄우고 실제 사용자 조작(클릭·입력)을 재현해 확인했습니다. `WebApp/Published/`를 정적 서버로 띄워 `/today/`와 `/shared/`가 실제 배포와 동일한 형제 경로가 되도록 재현했습니다.

- [x] 최초 로드: IndexedDB(`today-db`) 정상 open, `today-count` = `0/3`, 콘솔 오류·예외 0건
- [x] 자연어 입력 `내일 오후 3시 치과` → Someday에 제목 "치과"로 추가(날짜·시각이 문장에서 빠짐)
- [x] Someday → Today 승격(→) 3회로 3칸이 채워짐(`3/3`)
- [x] 4번째 항목을 추가해 승격을 시도 → **막힘**(그대로 `3/3` 유지, 겹쳐 쓰지 않음)
- [x] Today 항목 완료 체크 → Done(1)로 이동, Today가 `2/3`로 감소
- [x] 하위 단계 편집 시트에서 2개 추가 후 1개 체크 → "1/2 subtasks" 표시
- [x] Settings에서 글자 크기 17px 선택 → `--f` CSS 변수 즉시 적용
- [x] **페이지 새로고침 후에도** Today 개수(2/3)·Done(1)·Someday(1)·글자 크기(17px)·하위 단계 진행(1/2)이 모두 그대로 유지됨 (IndexedDB + localStorage 영속성 확인)
- [x] 위 전체 시나리오에서 콘솔 오류·경고·미처리 예외 **0건**

## 완료 조건 대조 (요청문 기준)

- [x] Today 3칸 고정, 4번째는 승격 차단
- [x] 하위 단계 최대 5개, 하위의 하위 없음, 제목+체크만
- [x] 자연어 파서가 지원 패턴을 정확히 인식하고, 실패 시 원문 유지(오류 메시지 없음)
- [x] 예정일이 마감일처럼 작동하지 않음 — 지난 예정일 경고 없음(코드에 색상 변화 로직 자체가 없음), 예정일이 오늘이어도 "오늘 후보"에만 노출되고 자동으로 Today에 들어가지 않음(모델 테스트 + 코드 경로로 확인)
- [x] daybook 3개 뷰(By app/Timeline/Markdown)에 today 기록이 보이도록 daybook 쪽 수정·테스트 완료(`daybook/tests/day-model.test.mjs`, `daybook/tests/markdown.test.mjs`)
- [x] tide → today 전송 동작(`tide/tests/send-to-today.test.cjs`로 고정, 비파괴 확인)
- [x] 백업(Export)·복원(Merge/Replace) 코드 경로 존재, loom/quill과 동일한 형식
- [x] 글자 크기 6단계 정상(브라우저에서 17px 확인, 6/8/10/14px은 동일 메커니즘 — `--f`만 바뀌고 클래스는 재사용)
- [x] 콘솔 오류 0건 (브라우저 검증)
- [x] shared·daybook·today 순서로 배포, 셋 다 Actions 성공

## Pending — 실기기(iPhone/iPad)에서 확인 필요

- [ ] 홈 화면에 추가(Add to Home Screen) 후 standalone 실행, 아이콘 모양
- [ ] 한글 IME 조합 중 Enter를 눌렀을 때 조합이 끊기며 저장되지 않는지 (`compositionstart`/`compositionend` 가드는 구현되어 있으나 실제 한글 입력기로는 미검증)
- [ ] 6px·8px 단계에서 실제 손가락 터치 시 버튼 겹침·잘림 여부(코드는 `.chip`/`.check`/`.actions button` 전부 44px 최소 지정, 시각 확인은 실기기 필요)
- [ ] Safe Area(노치·홈 인디케이터)와 키보드가 열린 상태에서 add bar가 가려지지 않는지
- [ ] 실제로 자정을 넘겨 앱을 다시 열었을 때 어제 Today 항목이 조용히 Someday로 돌아가는지(로직은 `reconcileToday` 유닛 테스트로 확인했으나 실제 기기 시계로는 미검증)
- [ ] iCloud Drive로 `today-backup-*.json`을 저장한 뒤 다시 가져오기
- [ ] tide의 Dump에서 "Send to today"를 눌렀을 때 실제로 Safari로 전환되어 today가 열리고 Someday에 추가되는지
- [ ] Journal을 켠 뒤 실제 GitHub 토큰으로 daybook에 항목이 나타나는지(private E2E, 사용자 credential 필요)
- [ ] 가로 화면(iPad)에서 레이아웃이 깨지지 않는지 — today는 세로 전용 예외 앱이 아니므로 가로에서도 정상 동작해야 함(코드는 `max-width:640px` 중앙 정렬로 세로/가로 모두 동일 레이아웃, 실기기 확인 필요)

## 2026-08-26 기기 간 동기화 (사용자 요청 추가)

배포된 today가 기기마다 로컬로만 저장되어 iPhone·iPad가 따로 노는 문제를 고쳤습니다. **새 구조를 만들지 않고 loom·tide·folio가 이미 쓰는 방식(private `webapp-data` + `shared/v1/sync.js`, `updatedAt` 기준 last-write-wins + tombstone)을 그대로 옮겼습니다.**

### 바꾼 파일

- `src/sync.js` — Journal 인증용 최소 기능이었던 것을 loom의 `sync.js`와 같은 구조로 확장. `isEnabled`/`setEnabled`/`getLastSyncAt`(신규), `getTaskTombstones`/`recordTaskDeletion`/`clearTaskTombstone`/`mergeTaskTombstones`/`applyTaskTombstones`(신규, loom의 `blockTombstones`와 동일한 로직), `pushData`/`pullData`(신규, loom의 `pushData`/`pullData`와 동일한 합집합·tombstone 적용 순서). `isReady()`가 `isEnabled()`도 함께 확인하도록 바뀜(Journal은 이 값과 무관하게 그대로 동작 — 회귀 테스트로 고정).
- `src/sync-runner.js` — 신규. loom의 `sync-runner.js`를 그대로 옮김: `attach()`(로컬 변경 시 tombstone 기록 + 4초 디바운스 푸시 예약), `runSync()`(받아오기→합치기→올리기 순서, `withoutTaskHook`으로 되돌이표 방지). today는 이벤트(B층)를 요청받지 않아 그 단계는 없음.
- `src/store.js` — 훅을 하나(`journalTaskChangeHook`)에서 둘(`journalTaskChangeHook`+`syncTaskChangeHook`)로 확장하고 `withoutTaskHook()` 추가(loom의 `hookSuppressed`/`withoutBlockHook`와 동일 구조). 기존 `bulkPutTasks`(백업 복원·자정 되돌리기 전용, 훅 스킵)는 변경 없음.
- `src/settings.js` — Sync 섹션에 "Sync this device" 토글, "Sync now" 버튼, 상태 줄(기기·마지막 동기화 시각) 추가.
- `src/app.js` — 부팅 시 `syncRunner.attach()` 호출(Journal 부착과 같은 자리), 시작 시 1회 `syncRunner.runSync()`(loom과 동일한 순서: attach 먼저, 화면이 뜬 뒤 동기화).
- `docs/README-KO.md`, `docs/USER-GUIDE-KO.md` — "today 자체 동기화는 없음" 설명을 실제 동작으로 교체, 켜는 순서와 병합 규칙 문서화.
- `sw.js`, `src/version.js` — 캐시 버전 `2026.08.26-today-v1` → `2026.08.26-sync1`, `src/sync-runner.js`를 캐시 목록에 추가.

### 기본값

**꺼짐(Off).** loom·tide·quill·focus 전부 동기화 기본값이 꺼짐이고, today도 동일하게 맞췄습니다. 켜려면 Settings → Sync에서 Device name·토큰을 넣고 "Sync this device"를 직접 켜야 합니다.

### 통과 — 자동

`npm test` **25/25 통과**(기존 19건 + 신규 6건), `npm run test:syntax` 통과. 신규 테스트:

- `isEnabled`/`setEnabled` 기본값 꺼짐, `isReady()`가 활성화+토큰+컨텍스트 셋 다 필요
- **tombstone이 오래된 원격 사본을 이기지만, 삭제 이후의 새 수정은 tombstone을 이김**(`applyTaskTombstones`) — 정확히 loom과 같은 규칙
- 같은 id를 지웠다가 다시 만들면 tombstone이 지워져 다음 동기화에서 다시 삭제되지 않음
- 다른 기기의 tombstone을 병합할 때 더 오래된 것이 로컬의 최신 tombstone을 덮지 않음(중복 제거)
- `describeError`가 모든 오류 유형에 대해 영문 한 줄을 만듦

### 통과 — 실제 브라우저(2026-08-26, 이 세션에서 헤드리스 Chrome + DevTools Protocol)

실제 GitHub 토큰이 없어 push/pull 네트워크 왕복 자체는 검증하지 못했습니다(아래 Pending). 다만 **네트워크 이전 단계, 즉 토큰 없이도 확인 가능한 전체 배선**은 실제 조작으로 확인했습니다.

- [x] 할 일을 추가한 뒤 삭제 → `sync.getTaskTombstones()`에 tombstone이 실제로 기록됨(로컬 mutation → 훅 → tombstone, 네트워크 없이 동작하는 부분)
- [x] Settings → Sync에서 토큰 없이 "Sync this device" 토글 → "Save an access token first" 토스트, 켜지지 않음
- [x] 토큰 저장 후 기기 이름 없이 토글 → "Enter a device name using English letters or numbers" 토스트, 켜지지 않음(두 가드가 순서대로 정확히 동작)
- [x] 토큰 저장 후 `tokenHint()`가 마지막 4자리만 표시
- [x] 전체 시나리오에서 콘솔 오류·예외 **0건**

### 완료 조건 대조

- [x] loom·tide·folio 방식 그대로 사용(private `webapp-data` + `shared/v1/sync.js`), 새 구조 없음
- [x] 동기화 대상: Today·오늘 후보·Someday·Done·하위 단계 전부(할 일 객체 하나에 상태·하위 단계가 함께 들어 있어 별도 배선 불필요)
- [x] 충돌 처리: 기존 앱들과 같은 `updatedAt` 기준 last-write-wins + tombstone(유닛 테스트로 고정)
- [x] 오프라인 생성 항목이 온라인 복귀 후 중복 없이 한 번만 반영 — id 기준 병합이 이를 구조적으로 보장(유닛 테스트로 고정), 실제 두 기기 간 네트워크 왕복은 Pending
- [x] Settings 토글 추가, 기본값 꺼짐(기존 앱들과 동일)
- [x] 3칸 고정·자동 이월 없음·숫자 미표시 원칙 불변 — 동기화는 원격의 `status`/`todayDate`를 그대로 받아올 뿐이고, 렌더링은 여전히 `todaySlotTasks()`가 상위 3개까지만 그림(코드 변경 없음, 회귀 없음)
- [x] `sw.js` 캐시 버전 상승, `src/sync-runner.js` 캐시 목록 등록
- [x] `docs/README-KO.md`의 "today 자체 동기화는 없음" 문구 교체

### Pending — 실기기 + 실제 토큰 필요

- [ ] **실제 iPhone·iPad 두 대에 같은 토큰으로 Sync를 켜고**: (1) 아이패드에서 항목을 추가하면 아이폰에 나타나는지 (2) 한쪽에서 체크·완료하면 다른 쪽에도 반영되는지 (3) 한쪽에서 삭제하면 다른 쪽에서도 사라지는지 (4) 한쪽을 비행기 모드로 두고 항목을 만든 뒤 온라인 복귀 시 중복 없이 한 번만 나타나는지
