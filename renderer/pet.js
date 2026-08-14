// ---- 캐릭터 상태 & 상수 ----
// (x, y)는 캐릭터의 "발밑 중앙" 픽셀 좌표. CSS transform: translate(-50%, -100%)로 앵커를 맞춤.
//
// 자율 이동/마우스 드래그는 없음 — 캐릭터는 관전 모드에서는 가만히 서 있고,
// 조작 모드(Shift+`)로 전환했을 때만 방향키/WASD로 직접 움직일 수 있음(3.6).

const petEl = document.getElementById('pet')
const bubbleEl = document.getElementById('speech-bubble')
const modeIndicatorEl = document.getElementById('mode-indicator')

const HALF_WIDTH = 32 // .pet 너비(64px)의 절반 — 화면 좌우 경계 clamp에 사용
const TOP_MARGIN = 56 // 화면 위쪽 clamp 여백(캐릭터가 화면 밖 위로 안 나가게)
const BOTTOM_MARGIN = 4 // 화면 아래쪽 clamp 여백
const MOVE_SPEED = 220 // px/second, 조작 모드 키보드 이동 속도
const BUBBLE_DURATION_MS = 2500

const LINES = [
  '안녕!',
  '오늘도 화이팅!',
  '심심하다~',
  '뭐 하고 있어?',
  '조금만 쉬었다 가자',
  '물 좀 마셔요',
  '스트레칭 어때?',
  '오늘 날씨 좋다',
  '나 좀 봐줘!',
  '냥~',
]

// 방향키 + WASD 모두 지원
const MOVE_KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
}

let x = window.innerWidth / 2
let y = window.innerHeight - 24
let facing = 'right'
let mode = 'spectate' // 'spectate' | 'control' — main.js가 mode-changed로 갱신
const keysDown = new Set()
let bubbleTimer = null
let lastTime = null

// ---- 렌더링 ----

function render() {
  petEl.style.left = `${x}px`
  petEl.style.top = `${y}px`
  petEl.classList.toggle('facing-left', facing === 'left')
  petEl.classList.toggle('walking', mode === 'control' && keysDown.size > 0)
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// ---- 조작 모드 이동 루프 ----

function tick(now) {
  if (lastTime === null) lastTime = now
  const dt = (now - lastTime) / 1000
  lastTime = now

  if (mode === 'control' && keysDown.size > 0) {
    let dx = 0
    let dy = 0
    if (keysDown.has('left')) dx -= 1
    if (keysDown.has('right')) dx += 1
    if (keysDown.has('up')) dy -= 1
    if (keysDown.has('down')) dy += 1

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) // 대각선 이동 시 속도가 더 빨라지지 않도록 정규화
      x = clamp(x + (dx / len) * MOVE_SPEED * dt, HALF_WIDTH, window.innerWidth - HALF_WIDTH)
      y = clamp(y + (dy / len) * MOVE_SPEED * dt, TOP_MARGIN, window.innerHeight - BOTTOM_MARGIN)
      if (dx > 0) facing = 'right'
      else if (dx < 0) facing = 'left'
    }
  }

  render()
  requestAnimationFrame(tick)
}

// ---- 모드 전환 (main.js의 전역 단축키 Shift+1 / Shift+` 로부터 전달됨) ----

window.petAPI.onModeChanged((newMode) => {
  mode = newMode
  keysDown.clear()
  modeIndicatorEl.textContent =
    mode === 'control' ? '조작 모드 (이동: 방향키/WASD, 종료: Esc)' : '관전 모드 (조작 전환: Shift+`)'
  render()
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

// ---- 클릭 통과 토글 + 클릭 시 말풍선 (관전/조작 모드 공통) ----
// 창은 기본적으로 클릭 통과 상태(main.js에서 forward:true로 설정)이므로,
// 캐릭터 위에 마우스가 올라오는 순간(mouseenter)에만 이 창이 실제 마우스 이벤트를
// 받도록 전환하고, 벗어나면(mouseleave) 다시 클릭 통과 상태로 되돌린다.

petEl.addEventListener('mouseenter', () => {
  window.petAPI.setIgnoreMouseEvents(false)
})

petEl.addEventListener('mouseleave', () => {
  window.petAPI.setIgnoreMouseEvents(true, { forward: true })
})

petEl.addEventListener('click', () => {
  showBubble(randomLine())
})

function randomLine() {
  return LINES[Math.floor(Math.random() * LINES.length)]
}

function showBubble(text) {
  bubbleEl.textContent = text
  bubbleEl.classList.add('visible')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => {
    bubbleEl.classList.remove('visible')
  }, BUBBLE_DURATION_MS)
}

// ---- 시작 ----

render()
requestAnimationFrame(tick)
