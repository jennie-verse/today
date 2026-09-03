# Today 사용 안내

## 홈 화면에 추가하기

1. iPhone/iPad Safari에서 `https://jennie-verse.github.io/today/` 를 엽니다.
2. 공유(Share) → 홈 화면에 추가(Add to Home Screen).
3. 홈 화면 아이콘으로 실행하면 브라우저 주소창 없이 앱처럼 동작합니다.

## 화면 구성

- **Today** — 오늘 할 일. 개수 제한은 없습니다. 안에서 다시 세 덩어리로 나뉘어 보입니다(옅은 구분선으로 구분):
  1. **Event**(`HH:MM` 시간 배지) — 시각 순
  2. **Task**(`☐` 체크박스) — 사용자가 정한 순서(입력순, ⋯ 메뉴의 위로/아래로로 바꿀 수 있음)
  3. **Note**(`—` 대시, 체크박스 없음) — 사용자가 정한 순서
- **Today candidates(오늘 후보)** — 예정일이 오늘인 Someday 항목이 자동으로 이 자리에 모입니다. Task/Note는 **자동으로 Today에 들어가지 않습니다.** "Add to Today" 버튼을 눌러야 들어갑니다. 단, **Event는 예정일이 오늘이면 자동으로 Today 맨 위로 옮겨집니다.**
- **Someday** — 접혀 있습니다. 열지 않아도 하루가 돌아갑니다.
- **Done** — **오늘 완료한 항목만** 보여줍니다(완료한 순서). 접혀 있습니다. 어제 이전에 완료한 항목은 앱을 열 때 이 기기에서는 조용히 정리되지만, **지난 기록은 Daybook에서 본다** — Journal(아래 항목 참고)이 켜져 있으면 완료 당일 Daybook에 이미 기록이 남아 있기 때문입니다.

## 할 일 추가하기(자연어 입력)

화면 아래 입력창에 문장을 그대로 치고 ＋를 누르거나 Enter를 치세요. 날짜·시각을 알아보면 자동으로 붙고, 문장에서는 빠집니다.

| 입력 예시 | 결과 |
|---|---|
| `내일 오후 3시 치과` | 제목 "치과", 예정일 내일, 오후 3시 |
| `다음주 화요일 회의` | 제목 "회의", 예정일 다음 주 화요일 |
| `8월 30일 생일파티` | 제목 "생일파티", 예정일 8월 30일 |
| `tomorrow 9am call` | 제목 "call", 예정일 내일, 오전 9시 |
| `재무 챕터 3 읽기` | 인식되는 날짜가 없으면 문장 그대로가 제목이 됩니다 |

- **반복 표현("매주 화요일")은 일부러 인식하지 않습니다.** 문장이 그대로 제목이 됩니다.
- 인식에 실패해도 오류 메시지는 뜨지 않습니다. 조용히 원래 문장이 제목이 됩니다.
- 여기서 붙는 날짜는 **예정일**이지 **마감일이 아닙니다.** 지나도 색이 바뀌거나 경고가 뜨지 않습니다.
- 한글 입력 중(조합 중)에는 Enter를 눌러도 문장이 잘리지 않습니다.

새로 추가된 항목은 항상 **Someday**로 들어갑니다. Today 3칸에 넣으려면 직접 "→" 버튼을 눌러야 합니다.

## `⋯` 메뉴

항목마다 있던 개별 아이콘 버튼들은 오른쪽 `⋯` 하나로 모여 있습니다. 눌러서 열리는 시트에는 상황에 맞는 항목만 보입니다:

- **Edit** — 제목(과 자연어로 넣은 날짜/시각)을 고칩니다.
- **Edit subtasks** — Task에만 보입니다.
- **Move up / Move down** — Today에서만 보이며, **같은 덩어리(Event/Task/Note) 안에서만** 순서를 바꿉니다.
- **Move to Someday / Move to Today** — 현재 위치에 따라 하나만 보입니다.
- **Archive to Done** — Note에만 보입니다. Note는 체크박스가 없어 이 메뉴로만 Done으로 보낼 수 있습니다.
- **Reopen** — Done에서만 보입니다. Someday로 돌아갑니다(Today로 자동 복귀하지 않습니다).
- **Delete** — 삭제 전 확인을 받습니다.

## 하위 단계(Subtasks)

- Task 항목의 `⋯` → Edit subtasks에서 하위 단계를 추가·삭제·체크할 수 있습니다.
- 하나의 항목에 최대 5개까지 붙일 수 있습니다.
- 하위 단계를 전부 체크해도 상위 항목이 자동으로 완료되지 않습니다. 완료는 상위 항목의 원 모양 체크를 직접 눌러야 합니다.

## 완료·되돌리기

- Task/Event는 항목 왼쪽의 원을 누르면 완료(Done)로 이동합니다. Note는 체크박스가 없으므로 `⋯` → Archive to Done을 사용합니다.
- Done에서 `⋯` → Reopen을 누르면 Someday로 돌아옵니다(Today로 자동 복귀하지 않습니다).

## 자정이 지나면

앱을 다시 열면 어제 Today에 있던 항목은 **조용히 Someday로 돌아갑니다.** 자동으로 오늘 칸에 남지 않습니다. 다시 Today에 넣고 싶으면 Someday 또는 "오늘 후보"에서 골라 넣으세요.

## 백업(Backup)·복원(Restore)

Settings(⚙) → Backup

- **Export JSON** — `today-backup-YYYY-MM-DD.json` 파일로 전체 저장.
- **Import JSON** — Merge(둘 다 유지, 최신 것이 이김) 또는 Replace all(현재 데이터를 지우고 교체) 중 선택. Replace all은 실행 취소(Undo) 토스트가 잠깐 뜹니다.

## 기기 간 동기화(Sync) — 선택 사항, 기본 꺼짐(2026-08-26 추가)

iPhone과 iPad에서 같은 할 일을 보고 싶을 때 켭니다. 꺼진 상태에서는 각 기기가 완전히 따로 동작합니다.

1. Settings(⚙) → Sync에서 **Device name**을 영문+숫자로 적습니다(예: `iphone-home`). 이 이름은 켜는 순간 파일 이름으로 굳고 나중에 바꿀 수 없습니다.
2. **Access token**(GitHub Personal Access Token)을 붙여 넣고 **Save token**을 누릅니다.
3. **Sync this device**를 켭니다.
4. 다른 기기(예: iPad)에서도 같은 토큰으로 1~3을 반복하되, **Device name은 기기마다 다르게** 적습니다(예: iPhone은 `iphone-home`, iPad는 `ipad-home`).

켠 뒤에는:

- Today·오늘 후보·Someday·Done·하위 단계가 전부 동기화됩니다.
- 한 기기에서 만든 항목을 다른 기기에서 체크하거나 완료할 수 있습니다.
- 한 기기에서 지운 항목은 다른 기기에서도 사라집니다.
- **오프라인에서 만든 항목도 안전합니다.** 온라인이 되면 자동으로(또는 Settings의 **Sync now**를 눌러) 합쳐지며, 같은 항목이 두 번 생기지 않습니다.
- **오늘 3칸 고정 원칙은 동기화 후에도 그대로입니다.** 다른 기기에서 Today를 이미 3개 채웠다면, 이 기기에서도 Today는 여전히 3칸까지만 보입니다 — 동기화가 이 제약을 늘리거나 밀린 개수를 보여주지 않습니다.

## Journal(Daybook 연동) — 선택 사항, 기본 꺼짐

Settings → Sync에서 기기 이름과 GitHub 액세스 토큰을 넣고, Journal 섹션의 "Include in journal"을 켜면 오늘 항목이 Daybook에 표시됩니다. (Sync 자체를 켜지 않아도 Journal만 따로 켤 수 있습니다 — 둘은 독립적입니다.)

- "Upload titles to private Journal"을 끄면 할 일 제목 대신 "Today task"만 전송됩니다.
- "Include subtask text"는 기본 꺼짐입니다. 켜지 않으면 하위 단계의 **개수**(예: 1/2)만 전송되고 **제목은 전송되지 않습니다.**
- Someday에만 있는 항목(아직 Today에 넣지 않은 항목)은 Journal에 전송되지 않습니다. Today에 넣거나 완료해야 Daybook에 나타납니다.
- Journal 기록에는 그날 마지막으로 속한 목록(`destination`: Today 또는 Someday)과 완료 여부(`done`)·최종 상태(`finalStatus`)가 함께 저장됩니다. 같은 날 Today↔Someday를 여러 번 오간 항목도 Daybook에는 마지막 목적지만 한 번 표시됩니다. 완료 후 다시 열어(재오픈) 미완료로 되돌린 항목은 완료로 잘못 표시되지 않습니다.

## Tide에서 보내기(Send to today)

tide 앱의 Dump 항목 메뉴에서 **→ Send to today**를 누르면 이 앱의 Someday에 새 항목으로 추가됩니다(Tide의 원본 항목은 지워지지 않습니다). Tide standalone 앱에서 누르면 Safari로 전환되어 Today가 열립니다 — 다른 앱으로 이동하는 링크와 같은 동작입니다.
