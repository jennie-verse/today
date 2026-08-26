# Today

오늘 할 일을 3개까지만 담는 개인용 웹앱입니다. 어제 못 한 항목은 자동으로 오늘로 넘어오지 않고, 밀린 개수·달성률·연속 기록 숫자를 화면에 띄우지 않습니다. 완전히 오프라인으로 동작하며 데이터는 이 기기에만 저장됩니다.

빌드 도구나 서버가 필요하지 않습니다. 이 폴더를 그대로 GitHub Pages에 올리면 `https://jennie-verse.github.io/today/`에서 실행됩니다.

## 사용

- 입력창에 문장을 그대로 치면(`내일 오후 3시 치과`처럼) 날짜·시각을 알아서 뽑아냅니다. AI를 쓰지 않는 정규식 파서입니다.
- 새 항목은 항상 Someday에 들어갑니다. Today 3칸에 넣으려면 직접 옮겨야 합니다.
- 데이터는 이 브라우저의 IndexedDB에 저장됩니다. Settings → Export JSON으로 정기적으로 백업하세요.

자세한 파일 구조와 자주 바꾸는 위치는 [구조와 바꾸는 법](docs/README-KO.md), 사용법은 [사용 안내](docs/USER-GUIDE-KO.md)를 보세요.

## 구성

`src/` 앱 코드(model·nlp-date·store·journal 등) · `assets/` 스타일과 로컬 글꼴 · `icons/` PWA 아이콘 · `docs/` 한국어 안내 · `manifest.webmanifest` · `sw.js` · `.nojekyll`
