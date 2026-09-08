# Test report — 2026-09-05 첫 릴리즈

## Automatically verified

- `npm test` — 46/46 passing. 다루는 내용:
  - `normalizeTask`가 `type`을 `"task"`로 기본값 처리하고, `source`에
    `"clip"`/`"tide"` 등 값을 정확히 구분.
  - 자연어 날짜/시간 파싱: 한국어(오늘/내일/모레, 요일, 다음주 X요일,
    N월 N일, 오전/오후 H시)와 영어(today/tomorrow/next X, am/pm) 모두 인식,
    반복 표현은 그대로 남겨둠, 알 수 없는 입력은 원문 그대로 유지.
  - Today 3-tier 정렬(Event → Task → Note), Someday order-sort/filter,
    `switchTaskKind`를 통한 종류 바꾸기, `splitNoteLines`/
    `tasksFromNoteLines`로 Note를 여러 Task로 분리할 때 순서 연속성.
  - Journal 연동: `taskToJournalRecord`가 카운트/부제목 텍스트를 설정에 맞게
    포함하고, 행의 type(task/note/event)을 함께 전달하는지.
  - Sync: 기본 비활성 상태(다른 앱들과 동일), `isReady`가 enabled+token+
    context를 모두 요구, tombstone 병합 규칙(로컬 삭제가 오래된 원격본을
    이기지만 더 최신 수정이 tombstone을 무효화, 여러 기기의 tombstone은
    가장 최근 `deletedAt`만 유지, 삭제 후 재생성 시 tombstone 해제), 모든
    에러 타입에 대해 `describeError`가 사람이 읽을 수 있는 문장을 만드는지.
- `npm run test:syntax` — `src/*.js`, `sw.js` 전부 `node --check` 통과.
- `sw.js`의 `VERSION`과 `src/version.js`의 `APP_BUILD`를
  `2026.09.05-firstrelease`로 함께 맞춤.
- 콘솔 오류: 이번 세션도 헤드리스 환경이라 실제 브라우저에서 직접 확인하지
  못했다. 대신 (a) 전체 파일 `node --check` 문법 검사, (b) 테스트가 검증한
  `state.tasks` 모양을 기준으로 주요 코드 경로를 손으로 추적, (c) 배포 후
  GitHub Actions `Test`/`Test and deploy GitHub Pages` 성공 확인으로 대체.

## 첫 릴리즈 초기화(fresh-start) 동작

- 이번 릴리즈부터 이 앱은 "첫 릴리즈"로 취급되어, 이전 개발 단계에서 쌓인
  로컬 데이터(과거 테스트용 Task/Note/Event 등)를 초기화하는 fresh-start
  리셋이 포함되어 있다.
- 리셋은 앱의 IndexedDB 저장소만 대상으로 하며, 다른 앱(shared/v1 등)이나
  기기의 다른 데이터에는 영향을 주지 않는다.
- 리셋 이후에는 정상적인 첫 사용 상태로 시작하며, Today/Someday/Done이 모두
  빈 상태에서 사용자가 새로 입력을 시작한다.

## Pending — 사용자 확인 필요

다음은 자동화로 확인할 수 없어 실제 기기에서 직접 확인이 필요합니다.

- **fresh-start 리셋 확인**: 실제로 앱을 열었을 때 이전 데이터가 전부
  사라지고 빈 상태로 시작하는지, 리셋이 반복 실행(재방문마다 또 초기화)되지
  않는지 확인.
- **동기화(Sync) 다중 기기 왕복**: 실제 Sync 토큰을 발급해 두 대 이상의
  기기에서 켠 뒤, 한 기기에서 추가/수정/삭제/이동한 내용이 다른 기기에도
  정확히 반영되는지, 오프라인 후 재연결 시 tombstone 병합이 실제로도
  예상대로 동작하는지 확인.
- **iPhone/iPad 실기기 확인**: 세로/가로 모드에서 Today/Someday/Done 레이아웃이
  깨지지 않는지, 글꼴 크기 6단계 전부에서 정상 표시되는지, 한글 IME로 조합
  중 Enter를 눌러도 Add bar/Edit 시트에서 문장이 잘리지 않는지, ⋯ 메뉴 등
  터치 영역이 44×44pt 이상으로 누르기 편한지 확인.


## 2026-09-08 안정성 개선 검증

- 수정: 한글 조합 Enter·중복 제출 방지, 다음 입력 보존, 지난 완료 기록 보존, 검증 후 원자적 백업 복원.
- 로컬 회귀 검사 및 JavaScript 문법 검사: 통과.
- Chromium 1280×900 / 390×844: 주요 조작, 재시작 후 기존 데이터 보존, 화면·페이지 오류 검사 통과.
- Service Worker를 통한 오프라인 앱 재실행: 통과.
- 실제 iPhone/iPad Safari, iCloud 공유, 실제 비공개 GitHub 데이터 동기화: 실기기 확인 필요.


## 2026-09-08 추가 안정성 검토 (review2)

- 변경: 쓰기 요청 성공이 아닌 트랜잭션 커밋 완료 후에만 저장 성공과 Journal/Sync hook 전달. 중단 시 실패 처리. DB 열기 실패 및 연결 종료 후 재연결.
- 검증: 전체 기존 테스트 및 추가 회귀 테스트, JavaScript 구문 검사. 격리된 Chromium에서 데스크톱 1280×900/모바일 390×844 저장·새로고침·실패 복구 검증. Browser plugin not available; bundled Playwright 사용.
- 주입 검증: 실제 IndexedDB 요청 성공 직후 abort 시 데이터/알림 미반영.
- 한계: 실제 iPhone Safari/Home Screen 및 개인 계정의 실서버 동기화는 직접 시험하지 않음.
