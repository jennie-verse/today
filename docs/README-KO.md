# Today — 무엇인지, 파일 구조, 바꾸는 법

## 무엇인지

Today는 할 일과 하루의 실제 활동을 기록하는 로컬 우선 웹앱입니다. 할 일 개수 제한은 없고 미완료 Today 항목은 다음 날로 이어집니다. Timeline은 별도의 활동 모델로 시각·구간·현재 활동과 Markdown 출력을 제공합니다.

저장소·배포 주소: `github.com/jennie-verse/today` → `https://jennie-verse.github.io/today/`

## 파일 구조

```text
today/
├─ .nojekyll                  GitHub Pages가 Jekyll로 처리하지 않도록 하는 표시 파일
├─ index.html                 앱 셸 (Today/후보/Someday/Done, add bar)
├─ manifest.webmanifest       PWA 설치 정보
├─ sw.js                      Service Worker — 오프라인 캐시
├─ assets/
│  ├─ app.css                 디자인 토큰과 스타일
│  └─ fonts/                  Lexend 400·700 (오프라인 동봉)
├─ src/
│  ├─ version.js               APP_BUILD — sw.js의 VERSION과 반드시 같아야 함
│  ├─ model.js                 항목 검증, Someday/Done/후보 분류, 미완료 이월
│  ├─ nlp-date.js              자연어 날짜·시각 파서 (정규식만, AI 없음)
│  ├─ store.js                 IndexedDB(`today-db`) 저장, localStorage 설정
│  ├─ sync.js                  webapp-data 기기 간 동기화(2026-08-26 추가, 기본 꺼짐) + Journal 인증용 device name/token
│  ├─ sync-runner.js           언제 동기화를 돌릴지 — 받아오기→합치기→올리기 순서, tombstone 기록
│  ├─ journal.js               shared/v2 Journal 연동 (선택 사항, 기본 꺼짐)
│  ├─ journal-record.js        task/task-activity Journal 레코드 만들기
│  ├─ backup.js                JSON 내보내기·가져오기
│  ├─ settings.js              설정 화면
│  ├─ ui.js                    토스트 · Undo · 확인창
│  └─ app.js                   화면 전체를 연결하는 진입점
├─ icons/                      앱 아이콘 (원본 SVG + PNG 3종)
├─ licenses/Lexend-OFL.txt     Lexend 폰트 라이선스
└─ docs/                       이 문서들
```

번들러나 빌드 도구는 쓰지 않습니다. `index.html`이 `src/app.js`만 `<script type="module">`로 불러오고, 나머지는 전부 `import`로 연결됩니다.

## 자주 바꾸는 위치

| 바꾸고 싶은 것 | 위치 |
|---|---|
| 앱 이름 | `index.html`의 `<title>`, `manifest.webmanifest`의 `name`/`short_name` |
| 대표색 | `assets/app.css` 맨 위 `:root` 안의 `--accent` 등 변수 |
| 할 일 분류·하위 단계 규칙 | `src/model.js` |
| 자연어 파서가 인식하는 표현 | `src/nlp-date.js` |
| 아이콘 | `icons/` 폴더 (`icons/icon-source.svg`가 원본) |

## 데이터가 저장되는 곳

- 할 일·하위 단계: 이 브라우저의 IndexedDB (`today-db`, `tasks` store)
- 글자 크기 등 설정: 이 브라우저의 localStorage (`today.settings.v1`)
- Journal 관련 설정(기기 이름·토큰·켬/끔): localStorage의 별도 키

동기화를 켜지 않은 기기에서 브라우저 저장소가 지워지면 데이터가 사라질 수 있습니다. 동기화 여부와 관계없이 Settings → Export JSON으로 정기 백업하세요. 자세한 사용법은 [사용 안내](USER-GUIDE-KO.md)를 확인하세요.

## 기기 간 동기화 (2026-08-26 추가)

today는 비공개 저장소 `webapp-data`와 loom·tide·folio가 이미 쓰는 방식을 그대로 따릅니다 — **새 구조를 만들지 않았습니다.** 동기화는 기본으로 **꺼져 있고**, 꺼진 상태에서도 앱은 완전히 동작합니다. 로컬 저장이 언제나 먼저입니다.

| 경로 | 내용 |
|---|---|
| `today/data.<기기>.json` | Today·오늘 후보·Someday·Done·하위 단계 전체(설정은 백업용으로만 함께 올라가고, 받을 때 적용하지 않음) |

관련 코드는 `src/sync.js`(GitHub 통신)와 `src/sync-runner.js`(언제·무엇을 보낼지)에 있습니다.

- **병합 규칙**: 같은 id는 `updatedAt`이 최신인 쪽이 이깁니다(loom과 동일한 `mergeById`).
- **삭제 동기화**: 기기에서 할 일을 지우면 tombstone(`{id, deletedAt}`)이 `today.taskTombstones.v1`에 남고 다른 기기로 퍼져, 지운 항목이 다시 살아나지 않습니다. 삭제 후 다시 그 id로 수정된 기록이 들어오면(사실상 재작성) tombstone보다 최신이면 살아납니다 — loom의 `applyBlockTombstones`와 같은 규칙입니다.
- **오프라인 → 온라인 복귀**: 오프라인 중 만든 항목도 로컬에는 즉시 저장됩니다. 온라인이 되면 다음 동기화(자동 4초 디바운스 또는 Settings → Sync now)에서 **id 기준으로 합쳐지므로 중복 없이 한 번만** 반영됩니다.
- **켜는 순서**: Settings → Sync에서 Device name(영문+숫자)을 먼저 적고, Access token을 저장한 뒤 **Sync this device**를 켭니다. Journal과 컨텍스트 ID를 공유하므로, Journal을 먼저 켰다면 같은 기기 이름이 이어집니다.
- **기본값**: 다른 모든 앱과 동일하게 **꺼짐**입니다.

## 설계 원칙

1. 기존 할 일 무제한·미완료 이월·당일 Event 승격을 유지합니다.
2. 실제 활동과 Task 예정 시각을 혼합하지 않습니다.
3. 저장 성공은 IndexedDB 트랜잭션 완료 후에만 표시합니다.
4. `sw.js` VERSION과 `src/version.js` APP_BUILD를 함께 올립니다.
5. Timeline의 동시 수정본은 보존하며 명시적으로 해결합니다.

현재 저장소가 직접 소유하는 `tests/today.test.mjs`가 model·파서·Journal 레코드 경계를 확인합니다. `npm test`로 재실행합니다.

## 입력 종류 칩과 Note

- 입력창 위 종류 칩(`☐ Task` / `— Note` / `⏱ Event`), Note 여러 줄 입력(textarea, 줄바꿈 보존), 마지막 선택 칩은
  `settings.lastAddKind`에 저장.
- `⋯` 메뉴에 **종류 바꾸기**(Task ⇄ Note ⇄ Event, `model.switchTaskKind`)와 Note 전용 **Turn into tasks**
  (`model.splitNoteLines` / `model.tasksFromNoteLines`) 추가.
- Someday는 `order` 오름차순 정렬(`model.somedayFiltered`)로 바뀌고, 필터 칩(`settings.somedayFilter`)과
  Note 카드 4줄 클램프(`-webkit-line-clamp`, `.note-clamp`/`.expanded`)가 추가됨.
- `src/journal-record.js`의 task 레코드 `data`에 `type`(task/note/event) 추가 — Daybook stage 4 준비용, Daybook
  자체는 아직 손대지 않음.
- `src/model.js`의 `source` 허용값에 `"clip"` 추가(`"tide"`는 계속 유효), `?add=` intake가 `?from=clip`도
  `?from=tide`와 같은 방식으로 인식 — clip 앱 자체는 아직 없어 지금은 비활성 상태.
- 새 코드도 전부 `textContent`만 사용, `innerHTML` 없음. Timeline 도입으로 IndexedDB는 v2이며 기존 tasks는 보존합니다.

## Timeline 구현 (2026.09.08-timeline1)

- `timeline-time.js`: AM/PM 파서, 시간대·DST 검증.
- `timeline-model.js`: 동일 ID 수정, revision 및 supersedes 인과 관계, 동시 수정 보존.
- `timeline-store.js`: IndexedDB v2의 timelineEntries / timelineConflicts / timelineMeta, 원자적 현재 활동 전환, 변경 토큰.
- `timeline-ui.js`: 입력·편집·날짜 탐색·타임테이블·목록·충돌 검토·내보내기.
- `timeline-markdown.js`: 양쪽 AM/PM, 빈 제목, 날짜 경계, Markdown 이스케이프.
- `timeline-sync.js`: `today/timeline/YYYY-MM/data.<기기>.json`; 생성 월 bucket 고정, SHA 재시도 시 다시 병합, 전송 중 새 변경 보존.
- `data-transfer.js`: 일관된 v2 백업과 복원·재시도. IDB 변경과 localStorage 이력 사이에 복원 대기 메타데이터를 저장합니다.

Timeline 파일은 기존 Task 동기화 파일과 분리됩니다. 파싱 실패·용량 초과를 빈 데이터로 덮어쓰지 않습니다. 오래된 기기가 Timeline 필드를 잃게 만들지 않으며, 양쪽 기기는 업데이트해야 Timeline을 볼 수 있습니다. 삭제 레코드와 revision 계보는 안전한 합의된 정리 기능이 생기기 전까지 유지합니다.
