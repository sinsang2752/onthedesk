const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

let launcherWindow = null
let overlayWindow = null
let inputWindow = null
let chatWindow = null
let tray = null
let isVisible = true
// 화면 상단 UI(좌상단 모드 표시 + 우상단 채팅 버튼/로그 패널)를 보여줄지 여부.
// 캐릭터·닉네임·말풍선과 채팅 기능 자체는 이 값과 무관하게 항상 동작한다.
// 실제 초기값은 저장된 설정에서 읽어온다(app.whenReady 참고).
let hudVisible = true
let mode = 'spectate' // 'spectate' | 'control' — 3.6 조작 모드
let chatOpen = false // 조작 모드 중 채팅 입력창이 떠 있는지
let sessionStarted = false // 런처를 지나 실제 캐릭터 세션이 시작됐는지
// inputWindow.hide()를 우리가 직접 호출해서 생기는 blur인지, 사용자가 실제로 다른 앱으로
// 전환해서 생긴(예기치 않은) blur인지 구분하기 위한 플래그 (아래 hideInputWindow 참고)
let intentionalInputBlur = false

// ---- 설정 파일 / 로컬 상태 저장 ----

function loadClientConfig() {
  const configDir = path.join(__dirname, 'config')
  const realPath = path.join(configDir, 'client-config.json')
  const examplePath = path.join(configDir, 'client-config.example.json')
  const filePath = fs.existsSync(realPath) ? realPath : examplePath
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return { signalingServerUrl: 'ws://localhost:8080' }
  }
}

const stateFilePath = path.join(app.getPath('userData'), 'onthedesk-state.json')

function loadLocalState() {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'))
  } catch {
    return {}
  }
}

function saveLocalState(partial) {
  const next = { ...loadLocalState(), ...partial }
  try {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true })
    fs.writeFileSync(stateFilePath, JSON.stringify(next))
  } catch {
    // 닉네임 저장 실패는 치명적이지 않으니 조용히 무시
  }
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    title: 'OnTheDesk',
    webPreferences: {
      preload: path.join(__dirname, 'launcher-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  launcherWindow.setMenuBarVisibility(false)
  launcherWindow.loadFile(path.join(__dirname, 'launcher', 'index.html'))

  launcherWindow.on('closed', () => {
    launcherWindow = null
    // 런처(로그인성 화면)를 그냥 닫으면 시작할 게 없으니 앱 자체를 종료.
    // 이미 세션이 시작된 뒤라면(오버레이가 떠 있음) 트레이 상주 앱이므로 종료하지 않음.
    if (!sessionStarted) {
      app.quit()
    }
  })
}

// 여러 모니터 중 오버레이를 띄울 대상을 정한다. 저장된/전달된 displayId가 없거나
// 지금은 연결되어 있지 않은 모니터라면(예: 외장 모니터를 뺀 채로 실행) 주 모니터로 대체.
function resolveTargetDisplay(displayId) {
  if (displayId == null) return screen.getPrimaryDisplay()
  const numericId = Number(displayId)
  const displays = screen.getAllDisplays()
  return displays.find((d) => d.id === numericId) || screen.getPrimaryDisplay()
}

// 런처에서 "방 만들기/참여하기/오프라인" 선택이 끝나면 실제 캐릭터 세션을 시작한다.
function startSession(params) {
  if (sessionStarted) return
  sessionStarted = true

  if (params.nickname) {
    saveLocalState({ nickname: params.nickname })
  }
  if (params.species) {
    saveLocalState({ species: params.species })
  }
  if (params.displayId != null) {
    saveLocalState({ displayId: Number(params.displayId) })
  }

  const targetDisplay = resolveTargetDisplay(params.displayId)

  createOverlayWindow(targetDisplay)
  createInputWindow()
  createChatWindow(targetDisplay)

  const initParams = {
    ...params,
    signalingServerUrl: loadClientConfig().signalingServerUrl,
    hudVisible, // 오버레이가 처음 그려질 때부터 저장된 설정이 반영되도록 같이 넘김
  }
  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow.webContents.send('init-params', initParams)
  })
  overlayWindow.showInactive()

  if (launcherWindow) {
    launcherWindow.close()
  }
}

function createOverlayWindow(targetDisplay) {
  const { x, y, width, height } = (targetDisplay || screen.getPrimaryDisplay()).bounds

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // 이 창(캐릭터가 그려지는 화면)은 절대 OS 키보드 포커스를 갖지 않음.
    // 조작 모드의 키보드 입력은 별도의 보이지 않는 inputWindow가 담당함 — 그렇지 않고
    // 이 창 자체의 focus()/blur()를 토글하면 모드 전환 시 캐릭터가 깜빡이는 문제가 있었음
    // (macOS에서 transparent+frameless 창이 key window 상태를 바꿀 때 생기는 재렌더링 현상).
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 풀스크린으로 실행 중인 다른 앱 위에도, 모든 데스크톱 공간(Space)에서도 보이게 함 (macOS)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 기본값: 마우스 클릭이 전부 통과됨(업무 방해 안 함). forward:true라서
  // mousemove는 렌더러까지 전달되어 캐릭터 위에서의 hover 감지가 가능함.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function createInputWindow() {
  // 화면 밖(1x1)에 떠 있는, 조작 모드 전용 "보이지 않는" 입력 창.
  // 조작 모드일 때만 show()로 띄워서 이 창이 실제 키보드 포커스를 가져가게 하고,
  // 관전 모드로 돌아가면 hide()로 사라지게 해서 포커스를 반환한다.
  inputWindow = new BrowserWindow({
    x: -10000,
    y: -10000,
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'input-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  inputWindow.loadFile(path.join(__dirname, 'renderer', 'input.html'))

  // 이 창이 포커스를 잃는 경우는 두 가지: (1) 우리가 직접 hide()해서(채팅창을 열거나
  // 관전 모드로 돌아갈 때) (2) 사용자가 실제로 다른 앱으로 전환해서(예기치 않은 경우).
  // (1)은 이미 의도한 전환이니 또 setMode를 부를 필요가 없고, (2)일 때만 조작 모드를
  // 종료해서 눌림 상태(keysDown)가 꼬이는 것을 방지해야 한다.
  inputWindow.on('blur', () => {
    // 채팅 입력창이 떠 있는 동안의 blur는 우리가 포커스를 넘겨준 결과다(정상).
    // 이 판단을 "blur 한 번 무시"처럼 횟수로 하면 안 된다 — 윈도우에서는 hide()와
    // chatWindow로의 포커스 이동에서 blur가 각각 한 번씩, 총 두 번 발생한다.
    // 그러면 두 번째 blur가 일회성 플래그를 통과해서 방금 연 채팅창이 곧바로
    // 관전 모드로 닫혀버린다.
    if (chatOpen) {
      intentionalInputBlur = false // 남은 플래그가 다음 blur를 잘못 삼키지 않게 정리
      return
    }
    if (intentionalInputBlur) {
      intentionalInputBlur = false
      return
    }
    setMode('spectate')
  })

  inputWindow.on('closed', () => {
    inputWindow = null
  })
}

// 우리가 의도적으로 inputWindow를 숨길 때는 항상 이 함수를 거쳐서,
// 뒤이어 발생하는 blur 이벤트가 오작동하지 않게 한다.
function hideInputWindow() {
  intentionalInputBlur = true
  inputWindow?.hide()
}

function createChatWindow(targetDisplay) {
  // 조작 모드 중 Enter를 누르면 화면 하단에 뜨는 채팅 입력창(3.6).
  // 실제 텍스트 입력(한글 조합 포함)에는 진짜 OS 포커스가 필요한데, 오버레이 창은
  // focusable:false라서 포커스를 받을 수 없음 — 그래서 이것도 별도의 작은 창으로 분리.
  // 오버레이와 같은 모니터에 떠야 하므로 그 모니터의 bounds(x/y 오프셋 포함)를 그대로 씀.
  const { x: dx, y: dy, width, height } = (targetDisplay || screen.getPrimaryDisplay()).bounds
  const winWidth = 480
  const winHeight = 56

  chatWindow = new BrowserWindow({
    x: dx + Math.round((width - winWidth) / 2),
    y: dy + height - winHeight - 40,
    width: winWidth,
    height: winHeight,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'chat-input-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat-input.html'))
  chatWindow.on('show', () => chatWindow.webContents.send('focus-input'))
  chatWindow.on('closed', () => {
    chatWindow = null
  })
}

function openChatInput() {
  if (mode !== 'control' || chatOpen) return
  chatOpen = true
  hideInputWindow() // 방향키 입력 창은 잠깐 포커스를 반환
  chatWindow?.show() // show()가 곧 포커스도 가져감
}

function closeChatInput() {
  if (!chatOpen) return
  chatWindow?.hide()
  if (mode === 'control') {
    inputWindow?.show() // 채팅이 끝나면 다시 방향키 입력으로 포커스 반환
  }
  // chatOpen은 창 전환이 끝난 뒤에 내린다 — 전환 중에 오는 blur까지 위 가드가 덮도록.
  chatOpen = false
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 18, height: 18 })
  }
  tray = new Tray(icon)
  tray.setToolTip('OnTheDesk 데스크톱 펫')
  updateTrayMenu()
}

function updateTrayMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: isVisible ? '캐릭터 숨기기' : '캐릭터 보이기',
      click: () => {
        isVisible = !isVisible
        if (overlayWindow) {
          if (isVisible) overlayWindow.showInactive()
          else overlayWindow.hide()
        }
        updateTrayMenu()
      },
    },
    {
      // 캐릭터/닉네임/말풍선과 채팅은 그대로 두고, 화면 상단의 모드 표시와
      // 채팅 버튼(+그 버튼으로 여는 로그 패널)만 감춘다.
      label: hudVisible ? '상단 UI 숨기기' : '상단 UI 보이기',
      click: () => {
        hudVisible = !hudVisible
        saveLocalState({ hudVisible })
        overlayWindow?.webContents.send('hud-visibility', hudVisible)
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit(),
    },
  ])
  tray.setContextMenu(menu)
}

// ---- 런처 IPC ----
ipcMain.handle('get-client-config', () => loadClientConfig())
ipcMain.handle('get-saved-nickname', () => loadLocalState().nickname || '')
ipcMain.on('save-nickname', (_event, nickname) => saveLocalState({ nickname }))
ipcMain.handle('get-saved-species', () => loadLocalState().species || 'cat')
ipcMain.on('save-species', (_event, species) => saveLocalState({ species }))
ipcMain.handle('get-displays', () => {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, index) => ({
    id: d.id,
    index,
    isPrimary: d.id === primaryId,
    width: d.bounds.width,
    height: d.bounds.height,
  }))
})
ipcMain.handle('get-saved-display-id', () => loadLocalState().displayId ?? null)
ipcMain.on('save-display-id', (_event, displayId) => saveLocalState({ displayId: Number(displayId) }))
ipcMain.on('launcher-start', (_event, params) => startSession(params))

// 렌더러가 캐릭터 위에서 마우스를 올리거나(hover) 벗어날 때
// 클릭 통과 여부를 토글하기 위해 보내는 요청
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.setIgnoreMouseEvents(ignore, options)
})

// 조작 모드에서 입력 창(input.js)이 Esc를 감지했을 때 관전 모드로 되돌리는 요청
// (Esc 자체는 전역 단축키로 등록하지 않음 — 다른 앱의 Esc 사용을 방해하지 않기 위해.
//  조작 모드일 땐 이미 inputWindow가 OS 포커스를 갖고 있어서 일반 keydown으로 충분히 잡힘)
ipcMain.on('exit-control-mode', () => setMode('spectate'))

// 입력 창이 잡은 방향키 입력을 오버레이 창(캐릭터)에게 릴레이
ipcMain.on('control-keydown', (_event, code) => {
  overlayWindow?.webContents.send('remote-keydown', code)
})
ipcMain.on('control-keyup', (_event, code) => {
  overlayWindow?.webContents.send('remote-keyup', code)
})

// 채팅 입력창 흐름 (3.3, 3.6)
ipcMain.on('open-chat-input', () => openChatInput())
ipcMain.on('chat-send', (_event, text) => {
  closeChatInput()
  overlayWindow?.webContents.send('chat-message-sent', text)
})
ipcMain.on('chat-cancel', () => closeChatInput())

// 개발용 디버그 채널: 실제 OS 전역 단축키 없이도 자동화 테스트에서 모드를 바꿔볼 수 있게 함.
// 패키징된 빌드(app.isPackaged === true)에서는 등록되지 않음.
if (!app.isPackaged) {
  ipcMain.on('__debug-set-mode', (_event, requestedMode) => setMode(requestedMode))
}

function setMode(newMode) {
  // 세션(오버레이)이 시작되기 전에는 모드라는 개념이 없다. 여기서 mode만 먼저 바꿔버리면
  // 런처 화면에서 Shift+`를 누른 것만으로 내부 상태가 'control'이 되어, 정작 세션이
  // 시작된 뒤에는 같은 단축키가 "이미 control"이라 무시되고 입력 창도 안 뜬다.
  if (!overlayWindow) return
  if (mode === newMode) return
  mode = newMode

  // 전역 단축키(Shift+1)로 강제로 관전 모드에 들어가는 경우 등, 채팅 입력 중이었다면 같이 정리
  if (chatOpen) {
    chatOpen = false
    chatWindow?.hide()
  }

  overlayWindow.webContents.send('mode-changed', mode)

  // 캐릭터가 그려지는 overlayWindow는 절대 건드리지 않고, 보이지 않는 inputWindow만
  // 보이거나(=포커스를 가져감) 숨긴다(=포커스 반환).
  if (mode === 'control') {
    inputWindow?.show()
  } else {
    hideInputWindow()
  }
}

function registerGlobalShortcuts() {
  // 관전 모드로 강제 전환 (모드 종료 단축키이기도 함 — 3.6 "모드 종료" 표 참고)
  globalShortcut.register('Shift+1', () => setMode('spectate'))
  // 조작 모드로 전환
  const controlOk = globalShortcut.register('Shift+`', () => setMode('control'))
  if (!controlOk) {
    console.warn('전역 단축키 Shift+` 등록 실패 — 다른 프로그램이 선점했을 수 있음')
  }
}

// inputWindow의 blur만으로는 "우리 앱의 다른 창으로 포커스 이동"과 "완전히 다른 앱으로
// 전환"을 구분하기 까다로운 경우가 있다(다중 모니터에서 다른 모니터의 다른 앱을 클릭하는
// 경우 등). macOS에서는 "앱 자체가 활성 상태를 잃었다"는 더 확실한 신호가 따로 있어서,
// 이걸로 한 번 더 안전하게 관전 모드로 되돌린다.
function registerAppActivationGuard() {
  if (process.platform !== 'darwin') return
  app.on('did-resign-active', () => setMode('spectate'))
}

app.whenReady().then(() => {
  hudVisible = loadLocalState().hudVisible !== false // 저장된 적 없으면 기본은 표시
  createTray()
  registerGlobalShortcuts()
  registerAppActivationGuard()
  createLauncherWindow() // 캐릭터 창은 런처에서 방 만들기/참여/오프라인을 고른 뒤에 생성됨(startSession)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 오버레이 창이 닫혀도 프로세스를 종료하지 않음.
  // 종료는 트레이 메뉴의 "종료"를 통해서만 이루어짐.
})
