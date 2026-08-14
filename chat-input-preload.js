const { contextBridge, ipcRenderer } = require('electron')

// 채팅 입력창(renderer/chat-input.js)이 window.chatAPI로 메인 프로세스와 통신하게 함.
contextBridge.exposeInMainWorld('chatAPI', {
  send: (text) => ipcRenderer.send('chat-send', text),
  cancel: () => ipcRenderer.send('chat-cancel'),
  // 메인 프로세스가 이 창을 show()할 때마다 알려줌 — 입력창을 비우고 포커스를 다시 잡기 위함
  onFocusInput: (callback) => {
    ipcRenderer.on('focus-input', () => callback())
  },
})
