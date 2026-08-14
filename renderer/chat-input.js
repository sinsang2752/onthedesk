// 채팅 입력 전용 창. 메인 프로세스가 이 창을 show()할 때만 화면에 보이고 포커스를 가짐.
// Enter로 전송, Esc로 취소 — 둘 다 메인 프로세스에 알려서 창을 다시 숨기고
// (조작 모드라면) 방향키 입력 창(input.js)에 포커스를 돌려준다.

const bar = document.getElementById('bar')
const input = document.getElementById('chat-text')

let lastSentAt = 0
const MIN_SEND_INTERVAL_MS = 500 // 간단한 도배 방지 — 정교한 정책은 Phase 6에서 보강

window.chatAPI.onFocusInput(() => {
  input.value = ''
  bar.classList.add('visible')
  requestAnimationFrame(() => input.focus())
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = input.value.trim()
    bar.classList.remove('visible')
    if (!text) {
      window.chatAPI.cancel()
      return
    }
    const now = Date.now()
    if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
      window.chatAPI.cancel() // 너무 빠른 연속 전송은 그냥 취소 처리
      return
    }
    lastSentAt = now
    window.chatAPI.send(text)
  } else if (e.key === 'Escape') {
    bar.classList.remove('visible')
    window.chatAPI.cancel()
  }
})
