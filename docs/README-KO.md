# Today — 무엇인지, 파일 구조, 바꾸는 법

## 무엇인지

Today는 오늘 할 일을 **3개까지만** 담는 개인용 웹앱입니다. 어제 못 한 항목은 자동으로 오늘로 넘어오지 않고, 밀린 개수·달성률·연속 기록 숫자를 화면에 띄우지 않습니다. 제약 자체가 기능입니다. 완전히 오프라인으로 동작하며 데이터는 이 기기에만 저장됩니다.

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
│  ├─ sync.js                  Journal 인증용 device name/token (today 자체 동기화는 없음)
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

기기를 바꾸거나 브라우저 저장소가 지워지면 데이터가 사라집니다. 정기적으로 Settings → Export JSON으로 백업하세요. 자세한 사용법은 [사용 안내](USER-GUIDE-KO.md)를 확인하세요.

## 설계 원칙 — 코드를 고칠 때도 지켜야 함

1. **오늘 칸은 3개 고정.** `model.js`의 `TODAY_SLOTS`를 늘리는 것은 계획에 없는 변경입니다.
2. **자동 이월 금지.** `reconcileToday()`가 매 실행 시 어제 남은 Today 항목을 조용히 Someday로 되돌립니다. 이 로직을 "다시 Today에 넣어주는" 방향으로 바꾸면 안 됩니다.
3. **예정일(scheduledFor)은 마감일이 아닙니다.** 지난 예정일에 색을 바꾸거나 경고를 넣지 마세요. 예정일이 오늘이어도 자동으로 Today 3칸에 넣지 마세요 — "오늘 후보"에만 노출합니다.
4. **자연어 파서는 반복 표현을 일부러 인식하지 않습니다.** `매주`/`매일`/`every` 뒤에 오는 날짜 단어는 건너뜁니다.
5. **`sw.js`의 `VERSION`과 `src/version.js`의 `APP_BUILD`는 항상 같은 값이어야 합니다.**
6. **`shared/v2/journal.js`는 additive로만 확장합니다.** `today` 앱과 `task`/`task-activity` kind를 shared 저장소에 이미 등록했습니다 (v3로 올리지 않음).

현재 저장소가 직접 소유하는 `tests/today.test.mjs`가 model·파서·Journal 레코드 경계를 확인합니다. `npm test`로 재실행합니다.
