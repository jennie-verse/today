# GitHub Pages 배포 안내

1. authoritative source인 `WebApp/Published/today/`에서 수정·테스트·commit·push합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 둡니다.
3. `.github/workflows/deploy.yml`이 `npm test`와 `npm run test:syntax`를 통과한 뒤 runtime allowlist만 Pages에 올립니다.
4. workflow가 성공하면 `https://jennie-verse.github.io/today/`을 열어 화면과 Service Worker version을 확인합니다.

배포 allowlist에는 `.nojekyll`, `README.md`, `index.html`, manifest, `sw.js`, `assets/`, `docs/`, `icons/`, `licenses/`, `src/`만 포함합니다. `tests/`, `package*.json`, `.github/`, `node_modules/`는 배포하지 않습니다.

모든 코드 경로가 `./` 상대 경로이므로 `/today/` 하위 경로에서 그대로 동작합니다. `../shared/v1/`, `../shared/v2/`처럼 형제 저장소도 상대 경로로 참조합니다 — GitHub Pages 사용자 사이트(`jennie-verse.github.io`)는 모든 저장소가 같은 오리진의 다른 경로이므로 이 참조가 성립합니다.

## 업데이트할 때

1. 수정한 파일을 commit해 `main`에 push합니다.
2. `sw.js`를 고쳤다면 맨 위 `VERSION`을 반드시 올리고, `src/version.js`의 `APP_BUILD`도 같은 값으로 맞춥니다.
3. `APP_SHELL` 목록에 새 파일을 추가했거나 파일 이름을 바꿨다면 목록도 함께 고칩니다.
4. Actions의 test와 Pages deployment가 모두 성공했는지 확인합니다.

## 배포 전 확인

- 저장소 최상위에 `index.html`, `.nojekyll`, `sw.js`, `manifest.webmanifest`가 있는지 확인합니다.
- Pages 주소를 열고 브라우저 개발자 도구에서 콘솔 오류와 404 요청이 0건인지 확인합니다.
- 할 일을 하나 추가하고 새로고침해도 남아 있는지 확인합니다.
- 한 번 온라인으로 연 뒤 기기를 비행기 모드로 바꾸고 다시 열어 오프라인에서 동작하는지 확인합니다.
- 실제 iPhone에서 홈 화면 설치, 아이콘 모양, standalone(주소창 없이) 실행을 확인합니다.

## 이 앱을 만들며 지킨 배포 순서

`shared`(today 앱·kind 등록) → `daybook`(today 소스 표시) → `today`(앱 본체) 순서로 배포했습니다. today가 Journal에 기록을 보내기 시작해도 shared 계약과 daybook 소비 코드가 이미 준비되어 있도록 하기 위해서입니다. `tide`(Send to today 링크)는 today 배포 이후에 별도로 적용했습니다.
