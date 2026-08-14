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
const {
  port,
  maxParticipants,
  heartbeatIntervalMs,
  emptyRoomGraceMs,
  joinRateLimitWindowMs,
  joinRateLimitMax,
} = require('./config')
const { generateRoomCode } = require('./roomCode')

// roomCode -> { participants: Map<participantId, { ws, nickname }>, lastActivityAt, emptiedAt }
const rooms = new Map()

// 참여 코드 무작위 대입 방지 (3.7): ip -> { count, windowStart }
const joinAttemptsByIp = new Map()

function isJoinRateLimited(ip) {
  const now = Date.now()
  const entry = joinAttemptsByIp.get(ip)
  if (!entry || now - entry.windowStart > joinRateLimitWindowMs) {
    joinAttemptsByIp.set(ip, { count: 1, windowStart: now })
    return false
  }
  entry.count += 1
  return entry.count > joinRateLimitMax
}

function clientIp(req) {
  // Render 등 리버스 프록시 뒤에서는 실제 클라이언트 IP가 X-Forwarded-For에 담겨 온다.
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
}

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

  const room = { participants: new Map(), lastActivityAt: Date.now(), emptiedAt: null }
  rooms.set(roomCode, room)
  return roomCode
}

function sanitizeNickname(nickname) {
  const trimmed = String(nickname || '').trim().slice(0, 20)
  return trimmed || '익명'
}

// 캐릭터 종류(species)는 클라이언트가 어떤 스프라이트를 그릴지 정하는 값일 뿐이라 서버는
// 내용을 해석하지 않지만, 알 수 없는/조작된 값이 다른 참여자에게 그대로 전달되지 않도록
// 화이트리스트로 한 번 걸러서 중계한다.
const ALLOWED_SPECIES = new Set(['cat', 'dog', 'frog', 'turtle'])
function sanitizeSpecies(species) {
  return ALLOWED_SPECIES.has(species) ? species : 'cat'
}

function removeParticipant(ws) {
  const meta = ws.__meta
  if (!meta) return
  ws.__meta = null

  const room = rooms.get(meta.roomCode)
  if (!room) return

  room.participants.delete(meta.participantId)

  if (room.participants.size === 0) {
    // 마지막 인원이 나가면 방을 삭제하되(3.1), 곧바로 지우지는 않고 잠깐 유예를 준다.
    // (예: 방을 만든 클라이언트가 확인 창을 닫고 실제 캐릭터 창으로 다시 접속하는 흐름처럼,
    //  참여자가 0명인 순간이 아주 짧게 스쳐 지나가는 정상적인 경우가 있음)
    room.emptiedAt = Date.now()
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
      const species = sanitizeSpecies(msg.species)

      room.participants.set(participantId, { ws, nickname, species })
      ws.__meta = { roomCode, participantId }

      send(ws, { type: 'room-created', roomCode, participantId })
      break
    }

    case 'join-room': {
      if (isJoinRateLimited(ws.__ip)) {
        send(ws, { type: 'error', code: 'RATE_LIMITED' })
        return
      }

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
      const species = sanitizeSpecies(msg.species)
      // 새로 들어온 사람에게 "이미 방에 있던 사람들" 목록을 줘서, 그 각각과
      // WebRTC 연결을 새로 맺을 수 있게 함 (3.2 "접속 직후" 참고)
      const existingParticipants = [...room.participants.entries()].map(([id, p]) => ({
        id,
        nickname: p.nickname,
        species: p.species,
      }))

      room.participants.set(participantId, { ws, nickname, species })
      ws.__meta = { roomCode, participantId }
      room.emptiedAt = null // 참여자가 생겼으니 유예 삭제 예약을 취소
      touchRoom(room)

      send(ws, { type: 'joined', roomCode, participantId, participants: existingParticipants })
      broadcast(room, { type: 'peer-joined', participantId, nickname, species }, participantId)
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

wss.on('connection', (ws, req) => {
  ws.__ip = clientIp(req)
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

// 참여자가 0명이 된 방을 유예시간(emptyRoomGraceMs)이 지난 뒤에 실제로 정리한다.
// 활성 참여자가 있는 방(participants.size > 0)은 절대 건드리지 않음.
const roomSweeperTimer = setInterval(
  () => {
    const now = Date.now()
    for (const [roomCode, room] of rooms) {
      if (room.participants.size === 0 && room.emptiedAt && now - room.emptiedAt > emptyRoomGraceMs) {
        rooms.delete(roomCode)
      }
    }
  },
  Math.min(emptyRoomGraceMs, 5000)
)

// join 시도 기록도 안 쓰는 IP는 주기적으로 정리 (메모리 누수 방지)
const joinAttemptsSweeperTimer = setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of joinAttemptsByIp) {
    if (now - entry.windowStart > joinRateLimitWindowMs) {
      joinAttemptsByIp.delete(ip)
    }
  }
}, Math.max(joinRateLimitWindowMs, 30_000))

server.listen(port, () => {
  console.log(`[onthedesk-signaling] listening on :${port}`)
})

function shutdown() {
  clearInterval(heartbeatTimer)
  clearInterval(roomSweeperTimer)
  clearInterval(joinAttemptsSweeperTimer)
  wss.close(() => {
    server.close(() => process.exit(0))
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
