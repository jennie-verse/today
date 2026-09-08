# Today

할 일과 하루의 실제 활동을 함께 기록하는 로컬 우선 개인용 웹앱입니다. Today 할 일은 개수 제한이 없고 미완료 항목은 다음 날로 이어집니다. Timeline은 시작 시각만 기록하거나 시작·종료 구간을 저장하고, 나중에 같은 기록에 종료 시각을 추가할 수 있습니다. 오프라인에서도 저장되며 선택적으로 비공개 `webapp-data`를 통해 기기 간 동기화합니다.

빌드 도구나 서버가 필요하지 않습니다. 이 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/today/`에서 실행됩니다.

## 사용

- 입력창에 문장을 그대로 치면(`내일 오후 3시 치과`처럼) 날짜·시각을 알아서 뽑아냅니다. AI를 쓰지 않는 정규식 파서입니다.
- 새 항목은 항상 Someday에 들어갑니다. Today에 넣으려면 직접 옮깁니다. 당일 Event는 자동으로 승격됩니다.
- 데이터는 이 브라우저의 IndexedDB에 저장됩니다. Settings → Export JSON으로 정기적으로 백업하세요.
- Journal을 켜면 그날 Today/Someday에 추가된 위치와 최종 완료 상태를 함께 기록하여 Daybook Markdown이 결과 중심 목록을 만들 수 있습니다.

자세한 파일 구조와 자주 바꾸는 위치는 [구조와 바꾸는 법](docs/README-KO.md), 사용법은 [사용 안내](docs/USER-GUIDE-KO.md)를 보세요.

## 구성

`src/` 앱 코드(model·nlp-date·store·journal 등) · `assets/` 스타일과 로컬 글꼴 · `icons/` PWA 아이콘 · `docs/` 한국어 안내 · `manifest.webmanifest` · `sw.js` · `.nojekyll`

## Timeline

상단 Timeline → `8:10am 샤워` → Save. 나중에 Add end time으로 종료 시각을 넣습니다. 지금 하는 활동은 Start, 끝나면 End now를 누릅니다. Export에서 요청한 `HH:MM AM/PM - HH:MM AM/PM 활동` 형식으로 복사하거나 `.md` 파일을 내려받습니다. 제목 없이 시각만 저장해도 됩니다.
