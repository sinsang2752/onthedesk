const { contextBridge, ipcRenderer } = require('electron')

// 입력 전용 창(renderer/input.js)이 window.inputAPI로 메인 프로세스와 통신하게 함.
contextBridge.exposeInMainWorld('inputAPI', {
  keyDown: (code) => ipcRenderer.send('control-keydown', code),
  keyUp: (code) => ipcRenderer.send('control-keyup', code),
  exitControlMode: () => ipcRenderer.send('exit-control-mode'),
  openChatInput: () => ipcRenderer.send('open-chat-input'),
})
