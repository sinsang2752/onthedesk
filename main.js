const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut } = require('electron')
const path = require('path')

let overlayWindow = null
let inputWindow = null
let tray = null
let isVisible = true
let mode = 'spectate' // 'spectate' | 'control' — 3.6 조작 모드

function createOverlayWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds

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

  inputWindow.on('closed', () => {
    inputWindow = null
  })
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
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit(),
    },
  ])
  tray.setContextMenu(menu)
}

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

// 개발용 디버그 채널: 실제 OS 전역 단축키 없이도 자동화 테스트에서 모드를 바꿔볼 수 있게 함.
// 패키징된 빌드(app.isPackaged === true)에서는 등록되지 않음.
if (!app.isPackaged) {
  ipcMain.on('__debug-set-mode', (_event, requestedMode) => setMode(requestedMode))
}

function setMode(newMode) {
  if (mode === newMode) return
  mode = newMode
  if (!overlayWindow) return

  overlayWindow.webContents.send('mode-changed', mode)

  // 캐릭터가 그려지는 overlayWindow는 절대 건드리지 않고, 보이지 않는 inputWindow만
  // 보이거나(=포커스를 가져감) 숨긴다(=포커스 반환).
  if (mode === 'control') {
    inputWindow?.show()
  } else {
    inputWindow?.hide()
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

app.whenReady().then(() => {
  createOverlayWindow()
  createInputWindow()
  createTray()
  registerGlobalShortcuts()
  overlayWindow.showInactive() // 포커스를 뺏지 않고 표시
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 오버레이 창이 닫혀도 프로세스를 종료하지 않음.
  // 종료는 트레이 메뉴의 "종료"를 통해서만 이루어짐.
})
