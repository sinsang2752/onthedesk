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
| `create-room` | `nickname` | 새 방을 만들고 그 방의 첫 참여자가 됨 |
| `join-room` | `roomCode`, `nickname` | 기존 방에 참여 |
| `signal` | `to`(participantId), `data` | SDP offer/answer, ICE candidate를 특정 상대에게 중계 요청 |
| `leave` | - | 방에서 나감(소켓을 그냥 끊어도 동일하게 처리됨) |

### 서버 → 클라이언트

| type | 필드 | 설명 |
|---|---|---|
| `room-created` | `roomCode`, `participantId` | 방 생성 완료, 발급된 코드와 내 참여자 ID |
| `joined` | `roomCode`, `participantId`, `participants: [{id, nickname}]` | 참여 완료. 이미 방에 있던 참여자 목록(이 각각과 WebRTC 연결을 새로 맺어야 함) |
| `peer-joined` | `participantId`, `nickname` | 새 참여자가 들어옴(기존 참여자들에게 브로드캐스트) |
| `peer-left` | `participantId` | 참여자가 나감(퇴장 또는 연결 끊김) |
| `signal` | `from`(participantId), `data` | 다른 참여자가 보낸 SDP/ICE 데이터. **`from`은 서버가 실제 연결 기준으로 붙이며 클라이언트가 보낸 값은 신뢰하지 않음** |
| `error` | `code` | `ROOM_NOT_FOUND` / `ROOM_FULL` / `NOT_IN_ROOM` / `PEER_NOT_FOUND` / `BAD_JSON` / `UNKNOWN_TYPE` |

`data`(signal의 페이로드)는 이 서버가 내용을 들여다보지 않고 그대로 중계만 하므로 형식은
클라이언트(Phase 3)에서 자유롭게 정의 가능. 예: `{ kind: 'offer' | 'answer' | 'ice-candidate', payload }`

## 환경변수

`.env.example` 참고. `PORT`, `ROOM_MAX_PARTICIPANTS`, `ROOM_INACTIVITY_TIMEOUT_MS`,
`HEARTBEAT_INTERVAL_MS`.

## Render 배포

로컬 테스트가 끝난 뒤 별도로 안내.
