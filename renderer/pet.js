// 로컬 캐릭터 상태머신 + 원격 참여자 캐릭터 반영 (3.2, 3.4, 3.6).
//
// 로컬 캐릭터: 관전 모드에서는 가만히 서 있고, 조작 모드에서만 방향키로 이동(기존 로직 유지).
// 원격 캐릭터: 상대가 보낸 "이동 시작/정지" 이벤트를 받아서, 로컬에서 매 프레임(rAF) 직접
//   위치를 계산해 그린다 — 네트워크 전송 빈도와 무관하게 항상 부드럽게 보이도록.

import { createCharacter, colorForText } from './character.js'
import { createNetworkSession } from './network.js'
import { toNormalized, fromNormalized } from './coords.js'
import { PET_SIZE } from './scale.js'

const modeIndicatorEl = document.getElementById('mode-indicator')
const chatToggleEl = document.getElementById('chat-toggle')
const chatPanelEl = document.getElementById('chat-panel')
const chatLogEl = document.getElementById('chat-log')

// 캐릭터 크기(PET_SIZE)가 해상도에 비례해서 달라지므로, 화면 경계 clamp 여백도
// 원래 비율(64px 기준 32/56/4)을 그대로 유지한 채 같이 비례해서 계산한다.
const HALF_WIDTH = PET_SIZE / 2 // 화면 좌우 경계 clamp에 사용
const TOP_MARGIN = Math.round(PET_SIZE * (56 / 64)) // 화면 위쪽 clamp 여백
const BOTTOM_MARGIN = Math.round(PET_SIZE * (4 / 64)) // 화면 아래쪽 clamp 여백
const MOVE_SPEED = 220 // px/second — 모든 클라이언트가 동일한 값을 써야 원격 예측이 정확함
const BUBBLE_DURATION_MS = 2500
const CHAT_MAX_LENGTH = 200 // 3.7 — 받는 쪽에서도 방어적으로 한 번 더 자름
const CHAT_RECEIVE_MIN_INTERVAL_MS = 300 // 3.7 — 받는 쪽 도배 방지(상대 클라이언트가 자체 제한을 무시해도 방어)

const LINES = [
  '안녕!', '오늘도 화이팅!', '심심하다~', '뭐 하고 있어?', '조금만 쉬었다 가자',
  '물 좀 마셔요', '스트레칭 어때?', '오늘 날씨 좋다', '나 좀 봐줘!', '냥~',
]

const MOVE_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// 이동 벡터(dx, dy)를 4방향 스프라이트 중 하나로 매핑. 더 크게 움직이는 축을 우선한다
// (대각선처럼 두 축이 같으면 상하 방향으로 결정됨).
function directionFromVector(dx, dy) {
  if (dx === 0 && dy === 0) return null
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

function randomLine() {
  return LINES[Math.floor(Math.random() * LINES.length)]
}

// ---- 채팅 로그 패널 (3.3) ----
// 캐릭터와 마찬가지로, 창은 기본 클릭 통과 상태라서 hover로 잠깐 풀어줘야 클릭/스크롤이 먹는다.
function wireHoverClickThrough(el) {
  el.addEventListener('mouseenter', () => window.petAPI.setIgnoreMouseEvents(false))
  el.addEventListener('mouseleave', () => window.petAPI.setIgnoreMouseEvents(true, { forward: true }))
}
wireHoverClickThrough(chatToggleEl)
wireHoverClickThrough(chatPanelEl)

chatToggleEl.addEventListener('click', () => {
  chatPanelEl.classList.toggle('open')
})

// ---- 상단 UI 표시/숨김 (트레이 메뉴) ----
// 숨겨도 캐릭터·닉네임·말풍선은 그대로 보이고, 채팅 송수신도 평소처럼 동작한다
// (조작 모드에서 Enter로 여는 입력창은 별도 창이라 여기 영향을 받지 않음).
function applyHudVisibility(visible) {
  document.body.classList.toggle('hud-hidden', !visible)
  if (visible) return

  // 열려 있던 로그 패널은 같이 닫는다 — 다시 열 버튼이 사라지기 때문.
  chatPanelEl.classList.remove('open')
  // 숨기는 순간 커서가 채팅 버튼/패널 위에 있었다면 mouseleave가 오지 않아
  // 오버레이가 계속 마우스를 가로채는 상태로 남는다. 직접 클릭 통과로 되돌린다.
  window.petAPI.setIgnoreMouseEvents(true, { forward: true })
}

window.petAPI.onHudVisibilityChanged(applyHudVisibility)

function appendChatLog({ nickname, color, text }) {
  const row = document.createElement('div')
  row.className = 'chat-log-row'

  const nameSpan = document.createElement('span')
  nameSpan.className = 'chat-log-name'
  nameSpan.textContent = nickname
  nameSpan.style.color = color

  const textSpan = document.createElement('span')
  textSpan.textContent = ': ' + text

  row.appendChild(nameSpan)
  row.appendChild(textSpan)
  chatLogEl.appendChild(row)
  chatLogEl.scrollTop = chatLogEl.scrollHeight
}

// 참여자 퇴장/연결 끊김처럼, 특정 발화자 없이 안내만 남기는 시스템 메시지
function appendSystemLog(text) {
  const row = document.createElement('div')
  row.className = 'chat-log-row system'
  row.textContent = text
  chatLogEl.appendChild(row)
  chatLogEl.scrollTop = chatLogEl.scrollHeight
}

// 상대가 보낸 값은 신뢰할 수 없으니(3.7) 타입/길이를 방어적으로 한 번 더 검증
function sanitizeIncomingChatText(text) {
  if (typeof text !== 'string') return ''
  return text.slice(0, CHAT_MAX_LENGTH).trim()
}

// ---- 로컬 캐릭터 상태 ----

let x = window.innerWidth / 2
let y = window.innerHeight / 2 // 시작 위치: 화면 정중앙
let facing = 'down' // 기본은 화면(카메라) 쪽을 보는 정지 자세
let mode = 'spectate' // 'spectate' | 'control' — main.js가 mode-changed로 갱신
const keysDown = new Set()

let localChar = null
let localNickname = ''
let network = null // 오프라인 모드면 null

// 마지막으로 "전송한" 이동 상태 — 상태가 바뀔 때만 네트워크로 보내기 위한 비교용 (3.2)
let lastSentMoving = false
let lastSentDirKey = null

// ---- 원격 참여자 ----
// peerId -> { character, motion, nickname }
const remotePeers = new Map()

function createRemoteMotion() {
  // 상대가 보낸 마지막 이벤트로부터 "죽은 셈 치고(dead-reckoning)" 현재 위치를 매 프레임 계산.
  // startTime은 반드시 Date.now() 기준(양쪽 프로세스의 performance.now()는 서로 비교 불가능!).
  let moving = false
  let dirX = 0
  let dirY = 0
  let startTime = 0
  let startX = 0
  let startY = 0
  let stoppedX = 0
  let stoppedY = 0

  return {
    applyMoveStart({ x: px, y: py, dirX: dx, dirY: dy, startTime: t }) {
      moving = true
      dirX = dx
      dirY = dy
      startX = px
      startY = py
      startTime = t
    },
    applyMoveStop({ x: px, y: py }) {
      moving = false
      stoppedX = px
      stoppedY = py
    },
    isMoving() {
      return moving
    },
    facing() {
      if (!moving) return null
      return directionFromVector(dirX, dirY)
    },
    computePosition() {
      if (!moving) return { x: stoppedX, y: stoppedY }
      const elapsedSec = Math.max(0, (Date.now() - startTime) / 1000)
      return {
        x: clamp(startX + dirX * MOVE_SPEED * elapsedSec, HALF_WIDTH, window.innerWidth - HALF_WIDTH),
        y: clamp(startY + dirY * MOVE_SPEED * elapsedSec, TOP_MARGIN, window.innerHeight - BOTTOM_MARGIN),
      }
    },
  }
}

function getCurrentStateMessage() {
  const { nx, ny } = toNormalized(x, y)
  if (mode === 'control' && keysDown.size > 0) {
    const dir = computeDirection()
    if (dir) {
      return { type: 'move-start', nx, ny, dirX: dir.dx, dirY: dir.dy, startTime: Date.now() }
    }
  }
  return { type: 'move-stop', nx, ny }
}

function computeDirection() {
  let dx = 0
  let dy = 0
  if (keysDown.has('left')) dx -= 1
  if (keysDown.has('right')) dx += 1
  if (keysDown.has('up')) dy -= 1
  if (keysDown.has('down')) dy += 1
  if (dx === 0 && dy === 0) return null
  const len = Math.hypot(dx, dy)
  return { dx: dx / len, dy: dy / len }
}

// 이동 상태가 실제로 바뀐 시점에만 네트워크로 이벤트를 내보낸다 (3.2 핵심 원칙).
function maybeEmitMovementEvent(dir) {
  if (!network) return

  if (!dir) {
    if (lastSentMoving) {
      const { nx, ny } = toNormalized(x, y)
      network.broadcast({ type: 'move-stop', nx, ny })
      lastSentMoving = false
      lastSentDirKey = null
    }
    return
  }

  const dirKey = `${dir.dx.toFixed(3)},${dir.dy.toFixed(3)}`
  if (dirKey !== lastSentDirKey) {
    const { nx, ny } = toNormalized(x, y)
    network.broadcast({ type: 'move-start', nx, ny, dirX: dir.dx, dirY: dir.dy, startTime: Date.now() })
    lastSentDirKey = dirKey
    lastSentMoving = true
  }
}

// ---- 렌더 루프 ----

let lastTime = null

function tick(now) {
  if (lastTime === null) lastTime = now
  const dt = (now - lastTime) / 1000
  lastTime = now

  // 로컬 캐릭터: 조작 모드일 때만 방향키로 이동
  if (mode === 'control' && keysDown.size > 0) {
    const dir = computeDirection()
    if (dir) {
      x = clamp(x + dir.dx * MOVE_SPEED * dt, HALF_WIDTH, window.innerWidth - HALF_WIDTH)
      y = clamp(y + dir.dy * MOVE_SPEED * dt, TOP_MARGIN, window.innerHeight - BOTTOM_MARGIN)
      facing = directionFromVector(dir.dx, dir.dy) || facing
    }
    maybeEmitMovementEvent(dir)
  } else {
    maybeEmitMovementEvent(null)
  }

  if (localChar) {
    localChar.setPosition(x, y)
    localChar.setDirection(facing)
    localChar.setWalking(mode === 'control' && keysDown.size > 0)
  }

  // 원격 캐릭터: 마지막으로 받은 이벤트로부터 로컬에서 직접 위치 계산
  for (const { character, motion } of remotePeers.values()) {
    const pos = motion.computePosition()
    character.setPosition(pos.x, pos.y)
    const f = motion.facing()
    if (f) character.setDirection(f)
    character.setWalking(motion.isMoving())
  }

  requestAnimationFrame(tick)
}

// ---- 모드 전환 (main.js의 전역 단축키 Shift+1 / Shift+` 로부터 전달됨) ----

function updateModeIndicatorText() {
  modeIndicatorEl.textContent =
    mode === 'control' ? '조작 모드 (이동: 방향키, 종료: Esc)' : '관전 모드 (조작 전환: Shift+`)'
}
// 접속 직후(아직 한 번도 모드가 안 바뀐 시점)에도 안내 문구가 보이도록 시작할 때 한 번 반영
updateModeIndicatorText()

window.petAPI.onModeChanged((newMode) => {
  mode = newMode
  keysDown.clear()
  updateModeIndicatorText()
})

// 이 창(오버레이)은 focusable:false라서 키보드 이벤트를 직접 받지 않는다.
// 실제 방향키 입력은 보이지 않는 input 창이 잡아서 메인 프로세스를 거쳐 전달해줌.
window.petAPI.onRemoteKeyDown((code) => {
  if (mode !== 'control') return
  const dir = MOVE_KEYS[code]
  if (dir) keysDown.add(dir)
})

window.petAPI.onRemoteKeyUp((code) => {
  const dir = MOVE_KEYS[code]
  if (dir) keysDown.delete(dir)
})

// 채팅 입력창(별도 창)에서 실제로 전송된 메시지 — 내 캐릭터 말풍선 + 로그 + 다른 참여자에게 전송
window.petAPI.onChatMessageSent((text) => {
  if (!localChar) return
  const trimmed = String(text || '').slice(0, CHAT_MAX_LENGTH).trim()
  if (!trimmed) return
  localChar.showBubble(trimmed, BUBBLE_DURATION_MS)
  appendChatLog({ nickname: localNickname, color: colorForText(localNickname), text: trimmed })
  network?.broadcast({ type: 'chat', text: trimmed })
})

// ---- 시작: 런처가 넘겨준 초기 파라미터에 따라 오프라인/멀티플레이 분기 ----

function startOffline({ nickname, species }) {
  localNickname = nickname
  localChar = createCharacter({
    nickname,
    species,
    color: colorForText(nickname),
    isLocal: true,
    onClick: () => localChar.showBubble(randomLine(), BUBBLE_DURATION_MS),
  })
}

function startMultiplayer({ signalingServerUrl, roomCode, nickname, species }) {
  localNickname = nickname
  localChar = createCharacter({
    nickname,
    species,
    color: colorForText(nickname),
    isLocal: true,
    onClick: () => localChar.showBubble(randomLine(), BUBBLE_DURATION_MS),
  })

  network = createNetworkSession({
    signalingServerUrl,
    roomCode,
    nickname,
    species,
    handlers: {
      onJoined() {
        // 필요하면 여기서 참여 완료 표시 등을 추가할 수 있음
      },
      onPeerJoined(peerId, peerNickname, peerSpecies) {
        const character = createCharacter({
          nickname: peerNickname,
          species: peerSpecies,
          color: colorForText(peerNickname),
          isLocal: false, // 원격 캐릭터는 관전 전용 — 클릭/드래그 등 상호작용 불가 (3.6)
        })
        remotePeers.set(peerId, { character, motion: createRemoteMotion(), nickname: peerNickname, lastChatAt: 0 })
        // 접속 직후 최초 상태 동기화: 새로 연결된 상대에게만 내 현재 상태를 즉시 알려줌 (3.2)
        network.sendTo(peerId, getCurrentStateMessage())
      },
      onPeerLeft(peerId) {
        const entry = remotePeers.get(peerId)
        if (!entry) return
        // tick 루프가 더 이상 이 캐릭터의 위치를 갱신하지 않도록 먼저 제거 —
        // 그 자리에 멈춰 선 채로 작별 말풍선만 잠깐 보여주고 사라지게 함
        remotePeers.delete(peerId)

        const text = `${entry.nickname}님과의 연결이 끊겼어요`
        entry.character.showBubble(text, 2000)
        appendSystemLog(text)
        setTimeout(() => entry.character.destroy(), 1800)
      },
      onPeerMessage(peerId, msg) {
        // peerId는 network.js가 "실제 DataChannel 기준"으로 넘겨준 값 — 메시지 안의
        // 어떤 자기 신고 ID도 신뢰하지 않는다 (3.7 위장 방지 원칙).
        const entry = remotePeers.get(peerId)
        if (!entry) return
        if (msg.type === 'move-start') {
          const pos = fromNormalized(msg.nx, msg.ny)
          entry.motion.applyMoveStart({ x: pos.x, y: pos.y, dirX: msg.dirX, dirY: msg.dirY, startTime: msg.startTime })
        } else if (msg.type === 'move-stop') {
          const pos = fromNormalized(msg.nx, msg.ny)
          entry.motion.applyMoveStop({ x: pos.x, y: pos.y })
        } else if (msg.type === 'chat') {
          // 받는 쪽 도배 방지 (3.7) — 상대 클라이언트가 자체 전송 제한을 무시하고 보내도
          // 내 화면/로그가 도배되지 않도록 너무 빠른 연속 메시지는 조용히 무시한다.
          const now = Date.now()
          if (now - entry.lastChatAt < CHAT_RECEIVE_MIN_INTERVAL_MS) return
          entry.lastChatAt = now

          const text = sanitizeIncomingChatText(msg.text)
          if (!text) return
          const color = colorForText(entry.nickname)
          entry.character.showBubble(text, BUBBLE_DURATION_MS)
          appendChatLog({ nickname: entry.nickname, color, text })
        }
      },
      onError(code) {
        console.error('[network] error:', code)
      },
    },
  })

  // 개발/테스트용 훅: devtools 콘솔에서 임의 payload를 내 실제 DataChannel로 보내볼 수 있게 함.
  // (내 연결 자체를 통해서만 나가므로, 어떤 payload를 넣어도 수신측에서는 여전히 "나"로만
  //  식별됨 — 3.7 소유권 검증이 프로토콜 구조상 우회 불가능함을 확인하는 용도)
  window.__debugSendRaw = (msg) => network?.broadcast(msg)
}

// 트레이의 "방 나가기" — P2P/시그널링 연결을 끊고 원격 캐릭터를 화면에서 지운다.
// 정리가 끝나면 메인 프로세스가 창을 닫고 런처로 돌아간다.
window.petAPI.onLeaveRoom(() => {
  try {
    network?.disconnect()
  } catch {
    // 이미 끊긴 연결일 수 있음 — 어차피 창이 닫히므로 무시
  }
  network = null
  for (const [peerId, entry] of remotePeers) {
    entry.character.destroy()
    remotePeers.delete(peerId)
  }
  window.petAPI.leaveRoomReady()
})

window.petAPI.onInitParams((params) => {
  applyHudVisibility(params.hudVisible !== false)
  if (params.mode === 'offline') {
    startOffline(params)
  } else {
    startMultiplayer(params)
  }
})

// ---- 렌더 루프 시작 ----

requestAnimationFrame(tick)
