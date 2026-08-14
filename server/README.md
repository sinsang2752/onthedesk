# onthedesk 시그널링 서버

데스크톱 펫 멀티플레이어용 WebRTC 시그널링 서버. 방 코드 발급/참여와 SDP·ICE 중계만
담당하며, 실제 캐릭터 위치나 채팅 메시지는 이 서버를 거치지 않는다(참여자끼리 WebRTC
DataChannel로 직접 주고받음).

## 로컬 실행

```bash
cd server
npm install
npm start
# listening on :8080
```

## 메시지 프로토콜

모든 메시지는 JSON 텍스트 프레임. `type` 필드로 구분.

### 클라이언트 → 서버

| type | 필드 | 설명 |
|---|---|---|
| `create-room` | `nickname`, `species` | 새 방을 만들고 그 방의 첫 참여자가 됨. `species`는 `cat`/`dog`/`frog`/`turtle` 중 하나(그 외 값은 서버가 `cat`으로 대체) |
| `join-room` | `roomCode`, `nickname`, `species` | 기존 방에 참여 |
| `signal` | `to`(participantId), `data` | SDP offer/answer, ICE candidate를 특정 상대에게 중계 요청 |
| `leave` | - | 방에서 나감(소켓을 그냥 끊어도 동일하게 처리됨) |

### 서버 → 클라이언트

| type | 필드 | 설명 |
|---|---|---|
| `room-created` | `roomCode`, `participantId` | 방 생성 완료, 발급된 코드와 내 참여자 ID |
| `joined` | `roomCode`, `participantId`, `participants: [{id, nickname, species}]` | 참여 완료. 이미 방에 있던 참여자 목록(이 각각과 WebRTC 연결을 새로 맺어야 함) |
| `peer-joined` | `participantId`, `nickname`, `species` | 새 참여자가 들어옴(기존 참여자들에게 브로드캐스트) |
| `peer-left` | `participantId` | 참여자가 나감(퇴장 또는 연결 끊김) |
| `signal` | `from`(participantId), `data` | 다른 참여자가 보낸 SDP/ICE 데이터. **`from`은 서버가 실제 연결 기준으로 붙이며 클라이언트가 보낸 값은 신뢰하지 않음** |
| `error` | `code` | `ROOM_NOT_FOUND` / `ROOM_FULL` / `NOT_IN_ROOM` / `PEER_NOT_FOUND` / `BAD_JSON` / `UNKNOWN_TYPE` / `RATE_LIMITED` |

`data`(signal의 페이로드)는 이 서버가 내용을 들여다보지 않고 그대로 중계만 하므로 형식은
클라이언트(Phase 3)에서 자유롭게 정의 가능. 예: `{ kind: 'offer' | 'answer' | 'ice-candidate', payload }`

## 환경변수

`.env.example` 참고. `PORT`, `ROOM_MAX_PARTICIPANTS`, `EMPTY_ROOM_GRACE_MS`,
`HEARTBEAT_INTERVAL_MS`, `JOIN_RATE_LIMIT_WINDOW_MS`, `JOIN_RATE_LIMIT_MAX`.

### 방 생성/삭제 흐름 참고
방을 만든 클라이언트(런처)가 코드를 보여준 뒤 연결을 끊고, 실제 캐릭터 창이 같은 코드로
다시 접속하는 구조라서, 참여자가 0명이 되는 순간이 아주 잠깐 스쳐 지나갈 수 있다. 그래서
참여자가 0명이 되어도 즉시 삭제하지 않고 `EMPTY_ROOM_GRACE_MS`만큼 기다렸다가 그때까지도
계속 0명이면 삭제한다.

## Render 배포

이미 배포되어 실제 운영 중: `wss://onthedesk-signaling.onrender.com`
(클라이언트의 `config/client-config.json`에서 이 주소를 가리키고 있음)

배포 방법:
1. GitHub에 이 레포를 올린다 (모노레포 그대로 — 별도 레포로 분리 안 함)
2. Render 대시보드 → **New +** → **Web Service** → 레포 선택
3. 설정: Root Directory `server`, Runtime Node, Build Command `npm install`, Start Command `npm start`, 인스턴스 Free
4. 환경변수는 `.env.example` 참고해서 필요한 것만 설정 (`PORT`는 Render가 자동 지정하므로 직접 설정하지 않음)
5. 배포되면 `https://<서비스이름>.onrender.com` 발급 → `wss://<서비스이름>.onrender.com`을 클라이언트 설정에 반영

무료 플랜은 15분 비활성 시 슬립되고 첫 요청 시 30~60초 콜드스타트가 있을 수 있음 — "방
만들기/참여하기" 시에만 영향이 있고, 연결된 뒤의 실제 트래픽(위치/채팅)은 이 서버를 거치지
않으므로 상관없다.

## 프라이버시/보안 (3.7)

- **이 서버가 실제로 저장/처리하는 값은 딱 이것뿐**: 방 코드, 참여자 ID(무작위 UUID),
  닉네임(참여자가 직접 입력한 문자열, 최대 20자), SDP/ICE 페이로드(WebRTC 연결 수립용,
  서버는 내용을 들여다보지 않고 그대로 중계만 함). 전부 메모리에만 있고 디스크/DB에
  저장하지 않으며, 서버가 재시작되면 전부 사라짐.
- **캐릭터 위치와 채팅 메시지는 이 서버를 절대 거치지 않는다** — 연결이 맺어진 뒤에는
  참여자끼리 WebRTC DataChannel로 직접 주고받는다. 서버가 이 내용을 볼 방법 자체가 없음.
- **IP 주소**는 참여 코드 무작위 대입 방지(rate limit)를 위해서만 메모리에서 잠깐
  참조하고(`JOIN_RATE_LIMIT_WINDOW_MS` 동안), 로그로 남기거나 어디에도 전송하지 않음.
- **다른 참여자 행세 방지**: `signal` 중계 시 `from` 필드는 클라이언트가 보낸 값을 쓰지
  않고 서버가 실제 WebSocket 연결 기준으로 채운다 — 다른 사람 ID를 사칭한 시그널을
  보낼 방법이 구조적으로 없음.
- **참여 코드 무작위 대입 방지**: 코드는 헷갈리는 문자를 뺀 32종 문자 × 6자리(크립토
  안전 난수)라 추측이 매우 어렵고, 추가로 같은 IP에서의 `join-room` 시도 횟수를
  `JOIN_RATE_LIMIT_MAX`/`JOIN_RATE_LIMIT_WINDOW_MS`로 제한한다.
