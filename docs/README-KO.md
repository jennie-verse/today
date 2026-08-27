# Today — 무엇인지, 파일 구조, 바꾸는 법

## 무엇인지

Today는 오늘 할 일을 **3개까지만** 담는 로컬 우선 개인용 웹앱입니다. 어제 못 한 항목은 자동으로 오늘로 넘어오지 않고, 밀린 개수·달성률·연속 기록 숫자를 화면에 띄우지 않습니다. 제약 자체가 기능입니다. 오프라인에서도 완전히 동작하며, 선택적으로 비공개 `webapp-data` 저장소를 통해 기기 간 동기화할 수 있습니다.

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
│  ├─ model.js                 항목 검증, 3칸 규칙, Someday/Done/후보 분류, 자정 이후 되돌리기
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
| 오늘 칸 개수(3), 하위 단계 상한(5) | `src/model.js`의 `TODAY_SLOTS`, `MAX_SUBTASKS` |
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

## 설계 원칙 — 코드를 고칠 때도 지켜야 함

1. **오늘 칸은 3개 고정.** `model.js`의 `TODAY_SLOTS`를 늘리는 것은 계획에 없는 변경입니다.
2. **자동 이월 금지.** `reconcileToday()`가 매 실행 시 어제 남은 Today 항목을 조용히 Someday로 되돌립니다. 이 로직을 "다시 Today에 넣어주는" 방향으로 바꾸면 안 됩니다.
3. **예정일(scheduledFor)은 마감일이 아닙니다.** 지난 예정일에 색을 바꾸거나 경고를 넣지 마세요. 예정일이 오늘이어도 자동으로 Today 3칸에 넣지 마세요 — "오늘 후보"에만 노출합니다.
4. **자연어 파서는 반복 표현을 일부러 인식하지 않습니다.** `매주`/`매일`/`every` 뒤에 오는 날짜 단어는 건너뜁니다.
5. **`sw.js`의 `VERSION`과 `src/version.js`의 `APP_BUILD`는 항상 같은 값이어야 합니다.**
6. **`shared/v2/journal.js`는 additive로만 확장합니다.** `today` 앱과 `task`/`task-activity` kind를 shared 저장소에 이미 등록했습니다 (v3로 올리지 않음).
7. **동기화가 3칸 고정·자동 이월 금지 원칙을 흔들면 안 됩니다.** 두 기기의 변경이 합쳐져 3개를 넘으면 첫 3개만 고정 슬롯에 두고, 초과분은 `Needs review`에 전부 노출합니다. 자동 삭제·자동 이동은 하지 않습니다.

현재 저장소가 직접 소유하는 `tests/today.test.mjs`가 model·파서·Journal 레코드 경계를 확인합니다. `npm test`로 재실행합니다.
