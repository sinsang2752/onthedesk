const { contextBridge, ipcRenderer } = require('electron')

// 렌더러(pet.js)가 window.petAPI로 안전하게 메인 프로세스와 통신할 수 있게 함.
contextBridge.exposeInMainWorld('petAPI', {
  // ignore=true면 클릭 통과(관통) 상태, false면 이 창이 마우스 이벤트를 직접 받음.
  // options.forward=true로 두면 ignore=true 상태에서도 mousemove는 렌더러로 전달되어
  // 캐릭터 위에서의 hover 감지(mouseenter/mouseleave)가 가능해짐.
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options)
  },
  // 메인 프로세스(전역 단축키)가 관전/조작 모드를 바꿀 때마다 알려줌
  onModeChanged: (callback) => {
    ipcRenderer.on('mode-changed', (_event, mode) => callback(mode))
  },
  // 조작 모드 중 Esc를 누르면 관전 모드로 되돌려달라고 메인에 요청
  exitControlMode: () => {
    ipcRenderer.send('exit-control-mode')
  },
  // 입력 전용 창(input.js)에서 잡은 키 입력이 메인 프로세스를 거쳐 여기로 전달됨
  onRemoteKeyDown: (callback) => {
    ipcRenderer.on('remote-keydown', (_event, code) => callback(code))
  },
  onRemoteKeyUp: (callback) => {
    ipcRenderer.on('remote-keyup', (_event, code) => callback(code))
  },
})
