# Today 사용 안내

## 홈 화면에 추가하기

1. iPhone/iPad Safari에서 `https://jennie-verse.github.io/today/` 를 엽니다.
2. 공유(Share) → 홈 화면에 추가(Add to Home Screen).
3. 홈 화면 아이콘으로 실행하면 브라우저 주소창 없이 앱처럼 동작합니다.

## 화면 구성

- **Today** — 오늘 할 일 3칸. 4번째를 넣으려면 하나를 완료하거나 Someday로 빼야 합니다.
- **Today candidates(오늘 후보)** — 예정일이 오늘인 Someday 항목이 자동으로 이 자리에 모입니다. **자동으로 Today 3칸에 들어가지 않습니다.** "Add to Today" 버튼을 눌러야 들어갑니다.
- **Someday** — 접혀 있습니다. 열지 않아도 하루가 돌아갑니다.
- **Done** — 완료한 항목을 날짜별로 모아 보여줍니다. 접혀 있습니다.

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

## 하위 단계(Subtasks)

- 항목의 ✎(Edit subtasks) 버튼을 누르면 하위 단계를 추가·삭제·체크할 수 있습니다.
- 하나의 항목에 최대 5개까지 붙일 수 있습니다.
- 하위 단계를 전부 체크해도 상위 항목이 자동으로 완료되지 않습니다. 완료는 상위 항목의 원 모양 체크를 직접 눌러야 합니다.
- Today 3칸 제한은 상위 항목만 셉니다. 하위 단계는 개수에 들어가지 않습니다.

## 완료·되돌리기

- 항목 왼쪽의 원을 누르면 완료(Done)로 이동합니다. Done에서 다시 누르면 Someday로 돌아옵니다(Today로 자동 복귀하지 않습니다).
- Today ↩(Move to Someday), Someday →(Move to Today), 🗑(Delete) 버튼으로 이동·삭제할 수 있습니다. 삭제는 확인을 받습니다.

## 자정이 지나면

앱을 다시 열면 어제 Today에 있던 항목은 **조용히 Someday로 돌아갑니다.** 자동으로 오늘 칸에 남지 않습니다. 다시 Today에 넣고 싶으면 Someday 또는 "오늘 후보"에서 골라 넣으세요.

## 백업(Backup)·복원(Restore)

Settings(⚙) → Backup

- **Export JSON** — `today-backup-YYYY-MM-DD.json` 파일로 전체 저장.
- **Import JSON** — Merge(둘 다 유지, 최신 것이 이김) 또는 Replace all(현재 데이터를 지우고 교체) 중 선택. Replace all은 실행 취소(Undo) 토스트가 잠깐 뜹니다.

## Journal(Daybook 연동) — 선택 사항, 기본 꺼짐

Settings → Sync에서 기기 이름과 GitHub 액세스 토큰을 넣고, Journal 섹션의 "Include in journal"을 켜면 오늘 항목이 Daybook에 표시됩니다.

- "Upload titles to private Journal"을 끄면 할 일 제목 대신 "Today task"만 전송됩니다.
- "Include subtask text"는 기본 꺼짐입니다. 켜지 않으면 하위 단계의 **개수**(예: 1/2)만 전송되고 **제목은 전송되지 않습니다.**
- Someday에만 있는 항목(아직 Today에 넣지 않은 항목)은 Journal에 전송되지 않습니다. Today에 넣거나 완료해야 Daybook에 나타납니다.

## Tide에서 보내기(Send to today)

tide 앱의 Dump 항목 메뉴에서 **→ Send to today**를 누르면 이 앱의 Someday에 새 항목으로 추가됩니다(Tide의 원본 항목은 지워지지 않습니다). Tide standalone 앱에서 누르면 Safari로 전환되어 Today가 열립니다 — 다른 앱으로 이동하는 링크와 같은 동작입니다.
