// 조작 모드 중 실제 OS 키보드 포커스를 갖는, 화면에 보이지 않는 입력 전용 창.
// 여기서 잡은 키 입력을 메인 프로세스를 거쳐 오버레이 창(pet.js)에 전달한다.
// 캐릭터가 그려지는 오버레이 창 자체는 절대 focus()/blur() 되지 않는다
// — 그렇게 했더니 모드 전환 시 캐릭터가 깜빡이는 문제가 있었음(macOS 투명창 재렌더링 이슈).

const MOVE_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'])

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    window.inputAPI.exitControlMode()
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

// 이 창이 예기치 않게 포커스를 잃으면(예: 사용자가 다른 방법으로 다른 앱으로 전환)
// 조작 모드도 함께 종료시켜 눌림 상태(keysDown)가 꼬이는 것을 방지
window.addEventListener('blur', () => {
  window.inputAPI.exitControlMode()
})
