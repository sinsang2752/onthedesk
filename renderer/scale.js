// 해상도에 따라 캐릭터/이름표/말풍선 같은 "게임 속 요소"의 크기를 비례해서 조정한다.
// 좌표를 정규화(0~1 비율)해서 주고받는 것과 같은 철학 — 각 클라이언트가 자기 화면
// 크기 기준으로 알아서 계산해서 그린다. 낮은 해상도에서 상대적으로 너무 커 보이거나,
// 높은 해상도에서 너무 작아 보이는 걸 방지한다.
//
// 참고: 크기는 네트워크로 주고받지 않는다 — 각자 자기 화면 기준으로 독립적으로 계산하므로,
// 모든 클라이언트가 "자기 화면 대비 몇 %" 크기로 보는 결과는 동일해도 절대 픽셀 값은
// 서로 다를 수 있다(좌표 정규화와 동일한 방식).

const BASE_PET_SIZE = 64 // 기준 해상도(REFERENCE_WIDTH)에서의 캐릭터 크기(px)
const REFERENCE_WIDTH = 1920
const MIN_PET_SIZE = 40 // 너무 작아져서 안 보이는 걸 방지
const MAX_PET_SIZE = 160 // 초고해상도에서 과도하게 커지는 걸 방지

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export const PET_SIZE = Math.round(clamp(BASE_PET_SIZE * (window.innerWidth / REFERENCE_WIDTH), MIN_PET_SIZE, MAX_PET_SIZE))
export const SCALE_FACTOR = PET_SIZE / BASE_PET_SIZE

const root = document.documentElement
root.style.setProperty('--pet-size', `${PET_SIZE}px`)
root.style.setProperty('--pet-nickname-size', `${Math.round(11 * SCALE_FACTOR)}px`)
root.style.setProperty('--pet-nickname-offset', `${Math.round(-16 * SCALE_FACTOR)}px`)
root.style.setProperty('--pet-bubble-font-size', `${Math.round(14 * SCALE_FACTOR)}px`)
root.style.setProperty('--pet-bubble-padding-v', `${Math.round(8 * SCALE_FACTOR)}px`)
root.style.setProperty('--pet-bubble-padding-h', `${Math.round(12 * SCALE_FACTOR)}px`)
root.style.setProperty('--pet-bubble-radius', `${Math.round(12 * SCALE_FACTOR)}px`)
