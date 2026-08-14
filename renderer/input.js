// 조작 모드 중 실제 OS 키보드 포커스를 갖는, 화면에 보이지 않는 입력 전용 창.
// 여기서 잡은 키 입력을 메인 프로세스를 거쳐 오버레이 창(pet.js)에 전달한다.
// 캐릭터가 그려지는 오버레이 창 자체는 절대 focus()/blur() 되지 않는다
// — 그렇게 했더니 모드 전환 시 캐릭터가 깜빡이는 문제가 있었음(macOS 투명창 재렌더링 이슈).

const MOVE_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    window.inputAPI.exitControlMode()
    return
  }
  if (e.code === 'Enter') {
    // 조작 모드 중 Enter -> 채팅 입력창 오픈 (3.6). 이 창은 채팅 입력창이 뜨는 동안
    // 메인 프로세스가 숨겨버리므로, 여기서는 그냥 요청만 보내고 더 신경 쓸 게 없음.
    window.inputAPI.openChatInput()
    return
  }
  if (MOVE_CODES.has(e.code)) {
    window.inputAPI.keyDown(e.code)
    e.preventDefault()
  }
})

window.addEventListener('keyup', (e) => {
  if (MOVE_CODES.has(e.code)) {
    window.inputAPI.keyUp(e.code)
    e.preventDefault()
  }
})

// 참고: 이 창이 예기치 않게 포커스를 잃는 경우(사용자가 다른 앱으로 전환 등)의 처리는
// main.js의 inputWindow 'blur' 핸들러에서 한다 — 거기서만 "우리가 일부러 숨긴 건지"를
// 구분할 수 있기 때문. 여기서 window blur를 그냥 감지해버리면, 채팅창을 열려고 이 창을
// 일부러 hide()할 때도 똑같이 걸려서 바로 관전 모드로 튕기는 문제가 있었음.
