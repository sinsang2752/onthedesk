# OnTheDesk

데스크톱 펫 멀티플레이어. Electron 기반 투명 오버레이 위에서 캐릭터가 화면 정중앙에 서 있다가,
조작 모드로 전환하면 방향키로 직접 움직일 수 있고, 참여 코드로 친구를 초대하면 서로의 캐릭터가
각자 화면에 함께 나타나 채팅도 할 수 있다.

## 주요 기능

- 투명·클릭통과·항상 위 오버레이 (평소엔 다른 작업을 방해하지 않음)
- 참여 코드로 방 생성/참여 → WebRTC P2P로 캐릭터 위치·채팅 직접 동기화 (시그널링 서버는 최초 연결만 중계)
- 참여자마다 해상도가 달라도 위치·크기가 화면 대비 비율로 일관되게 보임
- 고양이/강아지/개구리/거북이 4종 캐릭터, 참여자마다 다르게 선택 가능
- 관전 모드 ↔ 조작 모드(방향키 이동) ↔ 채팅 입력 전환 (전역 단축키)
- 다중 모니터 환경에서 표시할 모니터 선택 가능
- 채팅(말풍선 + 로그 패널), 참여 코드 무작위 대입 방지, 채팅 스팸 방지 등 최소한의 보안/프라이버시 조치

## 빠른 시작 (로컬 개발)

```bash
# 1) 시그널링 서버 (한 번만 하면 계속 켜둘 수 있음)
cd server
npm install
npm start          # listening on :8080

# 2) 클라이언트 (다른 터미널에서)
cd ..
npm install
npm start
```

첫 실행 시 `config/client-config.json`이 없으면 `config/client-config.example.json`
(`ws://localhost:8080`)을 기본값으로 사용한다. 실제 배포된 서버를 쓰려면
`config/client-config.json`을 만들어 `signalingServerUrl`을 `wss://...` 주소로 바꾸면 된다
(이 파일은 gitignore 대상이라 각자 로컬에서 따로 관리).

## 조작법

| 동작 | 단축키 |
|---|---|
| 관전 모드(기본) | `Shift + 1` |
| 조작 모드 (방향키로 이동) | `` Shift + ` `` |
| 채팅 입력 (조작 모드 중) | `Enter` → 입력 후 `Enter` 전송 / `Esc` 취소 |
| 모드 종료 → 관전 모드 복귀 | `Esc` |
| 캐릭터 클릭 | 랜덤 대사 말풍선 (내 캐릭터만 반응, 다른 참여자 캐릭터는 관전 전용) |

조작 모드 중 완전히 다른 앱으로 포커스가 넘어가면(다중 모니터에서 다른 모니터를 클릭하는 경우
포함) 자동으로 관전 모드로 돌아온다.

## 프로젝트 구조

```
onthedesk/
├── main.js                  # Electron 메인 프로세스 — 창 관리, 전역 단축키, IPC
├── preload.js                 # 오버레이 창 preload
├── input-preload.js            # 방향키 입력 전용 창 preload
├── chat-input-preload.js        # 채팅 입력창 preload
├── launcher-preload.js           # 런처(시작 화면) preload
├── launcher/                      # 방 만들기/참여/종·모니터 선택 화면
├── renderer/                       # 오버레이(캐릭터) 렌더러
│   ├── pet.js                       # 로컬 캐릭터 상태머신 + 원격 캐릭터 반영
│   ├── network.js                    # 시그널링 클라이언트 + WebRTC 메시 연결
│   ├── character.js                   # 캐릭터 DOM/스프라이트 렌더링
│   ├── coords.js                       # 좌표 정규화 (해상도 차이 대응)
│   ├── scale.js                         # 크기 정규화 (해상도 차이 대응)
│   └── assets/characters/                # 캐릭터 스프라이트 (4종 × 4방향 × 2프레임)
├── server/                                # 시그널링 서버 (Node.js + ws, Render 배포)
├── config/                                 # 클라이언트 설정 (시그널링 서버 주소)
├── assets/character-raw/                    # 캐릭터 원본 에셋(스프라이트 시트, 미리보기) — 참고용 원본
├── REQUIREMENTS.md                          # 최초 기획 문서 (8번 섹션에 실제 구현과의 차이 정리)
└── PRIVACY.md                                # 프라이버시/보안 요약
```

## 문서

- [REQUIREMENTS.md](./REQUIREMENTS.md) — 최초 기획 요구사항 + 실제 구현 결과/변경 사항(8번 섹션)
- [PRIVACY.md](./PRIVACY.md) — 이 앱이 다루는 데이터와 다루지 않는 데이터 요약
- [server/README.md](./server/README.md) — 시그널링 서버 프로토콜, 환경변수, Render 배포 방법

## 알려진 제한사항

- **자동 재연결 미구현**: P2P 연결이 완전히 끊기면 자동으로 재시도하지 않는다. 다시 하려면
  참여 코드로 재입장. (의도적으로 보류 — REQUIREMENTS.md 8번 참고)
- **다중 모니터 + macOS**: 보조 모니터를 선택했을 때 세로 위치가 약 30px 정도 살짝 어긋나는
  경우가 있음(Electron/macOS의 다중 모니터 좌표 처리 특성으로 추정, 원인 조사했으나 명확한
  해결책을 못 찾음). 실사용에는 거의 티가 안 나는 수준.
