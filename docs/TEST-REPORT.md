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
