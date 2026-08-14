// 런처: 실제 방 생성/참여 요청은 여기서 시그널링 서버에 직접 보내고(WebSocket),
// 성공하면 방 코드만 오버레이 창으로 넘겨서 오버레이 쪽에서 다시 join해 WebRTC를 시작한다.
// (창 사이에 살아있는 소켓을 직접 넘길 수 없어서 재접속 한 번을 감수하는 대신 구조를 단순하게 유지)

const RESPONSE_TIMEOUT_MS = 45000 // Render 무료 플랜 콜드스타트(30~60초) 감안

const nicknameInput = document.getElementById('nickname')
const speciesSelect = document.getElementById('species')
const speciesPreview = document.getElementById('species-preview')
const displayLabel = document.getElementById('display-label')
const displaySelect = document.getElementById('display-select')
const createBtn = document.getElementById('create-btn')
const roomCodeBox = document.getElementById('room-code-box')
const roomCodeText = document.getElementById('room-code-text')
const proceedBtn = document.getElementById('proceed-btn')
const roomCodeInput = document.getElementById('room-code-input')
const joinBtn = document.getElementById('join-btn')
const offlineBtn = document.getElementById('offline-btn')
const statusEl = document.getElementById('status')

let config = { signalingServerUrl: 'ws://localhost:8080' }
let pendingRoomCode = null
let displays = []

function setStatus(text, kind) {
  statusEl.textContent = text || ''
  statusEl.className = kind || ''
}

function setBusy(busy) {
  createBtn.disabled = busy
  joinBtn.disabled = busy
  offlineBtn.disabled = busy
}

const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: '존재하지 않는 참여 코드예요. 코드를 다시 확인해주세요.',
  ROOM_FULL: '방 인원이 가득 찼어요 (최대 인원 초과).',
  RATE_LIMITED: '너무 여러 번 시도했어요. 잠시 후 다시 시도해주세요.',
}

function updateSpeciesPreview() {
  speciesPreview.src = `../renderer/assets/characters/${speciesSelect.value}/down_0.png`
}

// 모니터가 1개뿐이면 고를 이유가 없으니 드롭다운 자체를 숨긴다.
async function initDisplays() {
  try {
    displays = await window.launcherAPI.getDisplays()
  } catch {
    displays = []
  }
  if (displays.length <= 1) return

  displaySelect.innerHTML = ''
  displays.forEach((d, i) => {
    const opt = document.createElement('option')
    opt.value = String(d.id)
    opt.textContent = `디스플레이 ${i + 1} (${d.width}×${d.height})${d.isPrimary ? ' · 주 모니터' : ''}`
    displaySelect.appendChild(opt)
  })

  try {
    const savedId = await window.launcherAPI.getSavedDisplayId()
    if (savedId != null && displays.some((d) => d.id === savedId)) {
      displaySelect.value = String(savedId)
    }
  } catch {
    // 무시
  }

  displayLabel.style.display = 'block'
  displaySelect.style.display = 'block'
}

// 모니터를 고를 필요가 없는 환경(1개)에서는 항상 undefined -> 메인 프로세스가 주 모니터로 처리
function selectedDisplayId() {
  return displays.length > 1 ? Number(displaySelect.value) : undefined
}

async function init() {
  try {
    config = await window.launcherAPI.getConfig()
  } catch {
    // 기본값 사용
  }
  try {
    const saved = await window.launcherAPI.getSavedNickname()
    if (saved) nicknameInput.value = saved
  } catch {
    // 무시
  }
  try {
    const savedSpecies = await window.launcherAPI.getSavedSpecies()
    if (savedSpecies) speciesSelect.value = savedSpecies
  } catch {
    // 무시
  }
  updateSpeciesPreview()
  await initDisplays()
}

speciesSelect.addEventListener('change', updateSpeciesPreview)

function requireNickname() {
  const nickname = nicknameInput.value.trim()
  if (!nickname) {
    setStatus('닉네임을 입력해주세요.', 'error')
    nicknameInput.focus()
    return null
  }
  return nickname
}

// 시그널링 서버에 한 번 접속해서 메시지 하나를 보내고, 응답(또는 타임아웃/에러)을 기다린다.
function requestOnce(message) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch {
        // 무시
      }
      reject(new Error('TIMEOUT'))
    }, RESPONSE_TIMEOUT_MS)

    try {
      ws = new WebSocket(config.signalingServerUrl)
    } catch (e) {
      clearTimeout(timer)
      reject(e)
      return
    }

    ws.onopen = () => {
      setStatus('서버에 연결됨. 요청 처리 중...', 'info')
      ws.send(JSON.stringify(message))
    }
    ws.onmessage = (event) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        reject(new Error('BAD_RESPONSE'))
        ws.close()
        return
      }
      resolve(data)
      ws.close()
    }
    ws.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('WS_ERROR'))
    }
  })
}

createBtn.addEventListener('click', async () => {
  const nickname = requireNickname()
  if (!nickname) return

  setBusy(true)
  setStatus('서버에 연결하는 중... (서버가 잠들어 있었다면 최대 1분 정도 걸릴 수 있어요)', 'info')
  roomCodeBox.style.display = 'none'

  try {
    const res = await requestOnce({ type: 'create-room', nickname, species: speciesSelect.value })
    if (res.type === 'room-created') {
      pendingRoomCode = res.roomCode
      roomCodeText.textContent = res.roomCode
      roomCodeBox.style.display = 'block'
      setStatus('방이 만들어졌어요. 참여 코드를 친구에게 알려주세요!', 'success')
    } else {
      setStatus(ERROR_MESSAGES[res.code] || `방 생성에 실패했어요 (${res.code || res.type})`, 'error')
    }
  } catch (e) {
    setStatus(
      e.message === 'TIMEOUT'
        ? '서버 응답이 없어요. 잠시 후 다시 시도해주세요.'
        : '서버에 연결하지 못했어요. 서버 주소 설정을 확인해주세요.',
      'error'
    )
  } finally {
    setBusy(false)
  }
})

proceedBtn.addEventListener('click', () => {
  const nickname = requireNickname()
  if (!nickname || !pendingRoomCode) return
  const displayId = selectedDisplayId()
  window.launcherAPI.saveNickname(nickname)
  window.launcherAPI.saveSpecies(speciesSelect.value)
  if (displayId !== undefined) window.launcherAPI.saveDisplayId(displayId)
  window.launcherAPI.start({ mode: 'multiplayer', roomCode: pendingRoomCode, nickname, species: speciesSelect.value, displayId })
})

joinBtn.addEventListener('click', async () => {
  const nickname = requireNickname()
  if (!nickname) return
  const roomCode = roomCodeInput.value.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
    setStatus('참여 코드는 6자리예요.', 'error')
    return
  }

  setBusy(true)
  setStatus('참여하는 중...', 'info')

  try {
    const res = await requestOnce({ type: 'join-room', roomCode, nickname, species: speciesSelect.value })
    if (res.type === 'joined') {
      setStatus('참여 완료! 시작합니다...', 'success')
      const displayId = selectedDisplayId()
      window.launcherAPI.saveNickname(nickname)
      window.launcherAPI.saveSpecies(speciesSelect.value)
      if (displayId !== undefined) window.launcherAPI.saveDisplayId(displayId)
      window.launcherAPI.start({ mode: 'multiplayer', roomCode, nickname, species: speciesSelect.value, displayId })
    } else {
      setStatus(ERROR_MESSAGES[res.code] || `참여에 실패했어요 (${res.code || res.type})`, 'error')
      setBusy(false)
    }
  } catch (e) {
    setStatus(
      e.message === 'TIMEOUT'
        ? '서버 응답이 없어요. 잠시 후 다시 시도해주세요.'
        : '서버에 연결하지 못했어요. 서버 주소 설정을 확인해주세요.',
      'error'
    )
    setBusy(false)
  }
})

offlineBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || '나'
  const displayId = selectedDisplayId()
  window.launcherAPI.saveNickname(nickname)
  window.launcherAPI.saveSpecies(speciesSelect.value)
  if (displayId !== undefined) window.launcherAPI.saveDisplayId(displayId)
  window.launcherAPI.start({ mode: 'offline', nickname, species: speciesSelect.value, displayId })
})

init()
