// OnTheDesk 시그널링 서버
//
// 이 서버가 하는 일은 딱 세 가지뿐이다 (REQUIREMENTS.md 2.2):
//   1) 방 코드 발급 / 참여
//   2) 참여자 사이의 SDP(offer/answer)·ICE candidate 중계
//   3) 참여자 접속/퇴장 감지 및 방 정리
// 캐릭터 위치나 채팅 메시지는 이 서버를 절대 거치지 않는다 — 연결이 맺어진 뒤에는
// 참여자끼리 WebRTC DataChannel로 직접 주고받는다 (Phase 3/4에서 클라이언트 쪽에 구현).

const http = require('http')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')
const { port, maxParticipants, roomInactivityTimeoutMs, heartbeatIntervalMs } = require('./config')
const { generateRoomCode } = require('./roomCode')

// roomCode -> { participants: Map<participantId, { ws, nickname }>, lastActivityAt }
const rooms = new Map()

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function broadcast(room, message, exceptParticipantId) {
  for (const [id, participant] of room.participants) {
    if (id === exceptParticipantId) continue
    send(participant.ws, message)
  }
}

function touchRoom(room) {
  room.lastActivityAt = Date.now()
}

function createRoom() {
  let roomCode
  do {
    roomCode = generateRoomCode()
  } while (rooms.has(roomCode))

  const room = { participants: new Map(), lastActivityAt: Date.now() }
  rooms.set(roomCode, room)
  return roomCode
}

function sanitizeNickname(nickname) {
  const trimmed = String(nickname || '').trim().slice(0, 20)
  return trimmed || '익명'
}

function removeParticipant(ws) {
  const meta = ws.__meta
  if (!meta) return
  ws.__meta = null

  const room = rooms.get(meta.roomCode)
  if (!room) return

  room.participants.delete(meta.participantId)

  if (room.participants.size === 0) {
    // 마지막 인원이 나가면 방 자동 삭제 (3.1)
    rooms.delete(meta.roomCode)
  } else {
    touchRoom(room)
    broadcast(room, { type: 'peer-left', participantId: meta.participantId }, null)
  }
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create-room': {
      const roomCode = createRoom()
      const room = rooms.get(roomCode)
      const participantId = crypto.randomUUID()
      const nickname = sanitizeNickname(msg.nickname)

      room.participants.set(participantId, { ws, nickname })
      ws.__meta = { roomCode, participantId }

      send(ws, { type: 'room-created', roomCode, participantId })
      break
    }

    case 'join-room': {
      const roomCode = String(msg.roomCode || '').trim().toUpperCase()
      const room = rooms.get(roomCode)

      if (!room) {
        send(ws, { type: 'error', code: 'ROOM_NOT_FOUND' })
        return
      }
      if (room.participants.size >= maxParticipants) {
        send(ws, { type: 'error', code: 'ROOM_FULL' })
        return
      }

      const participantId = crypto.randomUUID()
      const nickname = sanitizeNickname(msg.nickname)
      // 새로 들어온 사람에게 "이미 방에 있던 사람들" 목록을 줘서, 그 각각과
      // WebRTC 연결을 새로 맺을 수 있게 함 (3.2 "접속 직후" 참고)
      const existingParticipants = [...room.participants.entries()].map(([id, p]) => ({
        id,
        nickname: p.nickname,
      }))

      room.participants.set(participantId, { ws, nickname })
      ws.__meta = { roomCode, participantId }
      touchRoom(room)

      send(ws, { type: 'joined', roomCode, participantId, participants: existingParticipants })
      broadcast(room, { type: 'peer-joined', participantId, nickname }, participantId)
      break
    }

    case 'signal': {
      const meta = ws.__meta
      if (!meta) {
        send(ws, { type: 'error', code: 'NOT_IN_ROOM' })
        return
      }
      const room = rooms.get(meta.roomCode)
      if (!room) return

      const target = room.participants.get(msg.to)
      if (!target) {
        send(ws, { type: 'error', code: 'PEER_NOT_FOUND' })
        return
      }

      touchRoom(room)
      // from은 클라이언트가 보낸 값을 쓰지 않고 서버가 실제 연결 기준으로 붙인다.
      // (다른 참여자 행세를 하는 위장 시그널 방지 — 3.7과 같은 원칙)
      send(target.ws, { type: 'signal', from: meta.participantId, data: msg.data })
      break
    }

    case 'leave': {
      removeParticipant(ws)
      break
    }

    default: {
      send(ws, { type: 'error', code: 'UNKNOWN_TYPE' })
    }
  }
}

// Render 등 호스팅 플랫폼의 HTTP 헬스체크에 응답하기 위한 최소 HTTP 서버.
// 실제 트래픽은 전부 같은 포트에 붙는 WebSocket 쪽에서 처리한다.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('onthedesk signaling server OK')
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', code: 'BAD_JSON' })
      return
    }
    handleMessage(ws, msg)
  })

  ws.on('close', () => removeParticipant(ws))
  ws.on('error', () => removeParticipant(ws))
})

// 네트워크 순단 등으로 close 이벤트가 안 오는 좀비 연결을 감지해서 강제 종료.
// terminate()는 'close' 이벤트를 발생시키므로 removeParticipant로 자연스럽게 이어짐.
const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, heartbeatIntervalMs)

// 안전망: 참여자가 0명인데도 남아있는 방 정리 (정상 흐름에서는 발생하지 않아야 함 —
// removeParticipant가 즉시 삭제하기 때문. 활성 참여자가 있는 방은 절대 건드리지 않음)
const roomSweeperTimer = setInterval(
  () => {
    const now = Date.now()
    for (const [roomCode, room] of rooms) {
      if (room.participants.size === 0 && now - room.lastActivityAt > roomInactivityTimeoutMs) {
        rooms.delete(roomCode)
      }
    }
  },
  Math.min(roomInactivityTimeoutMs, 5 * 60 * 1000)
)

server.listen(port, () => {
  console.log(`[onthedesk-signaling] listening on :${port}`)
})

function shutdown() {
  clearInterval(heartbeatTimer)
  clearInterval(roomSweeperTimer)
  wss.close(() => {
    server.close(() => process.exit(0))
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
