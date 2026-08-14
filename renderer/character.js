// 캐릭터 DOM 생성/렌더링 공통 로직. 로컬 캐릭터와 원격 참여자 캐릭터 모두 이걸로 만든다.
//
// 소유권 원칙(3.6/3.7): 원격(isLocal:false) 캐릭터는 절대 클릭/드래그 등 어떤 마우스
// 상호작용도 받지 않는다(pointer-events: none, CSS로 강제). 로컬 캐릭터만 hover 시
// 클릭 통과를 풀어서 클릭 상호작용(말풍선)을 받을 수 있다.
//
// 스프라이트: 방향(up/down/left/right) × 프레임(0=정지, 1=이동) 조합의 16x16 PNG를 사용.
// 이동 중에는 0/1 프레임을 번갈아 보여줘서 걷기 애니메이션처럼 보이게 한다.

import './scale.js' // 화면 해상도에 맞는 크기 CSS 변수를 설정함 (side effect)

const container = document.getElementById('characters-root')
const template = document.getElementById('character-template')

export const SPECIES_LIST = ['cat', 'dog', 'frog', 'turtle']
const DEFAULT_SPECIES = 'cat'
const WALK_FRAME_INTERVAL_MS = 220

function normalizeSpecies(species) {
  return SPECIES_LIST.includes(species) ? species : DEFAULT_SPECIES
}

function spritePath(species, direction, frame) {
  return `./assets/characters/${normalizeSpecies(species)}/${direction}_${frame}.png`
}

export function createCharacter({ nickname = '', color = '#333', isLocal = false, species = DEFAULT_SPECIES, onClick } = {}) {
  const fragment = template.content.cloneNode(true)
  const el = fragment.querySelector('.pet')
  const bubbleEl = el.querySelector('.speech-bubble')
  const nicknameEl = el.querySelector('.nickname')
  const spriteEl = el.querySelector('.sprite')

  el.classList.toggle('local', isLocal)
  nicknameEl.textContent = nickname
  nicknameEl.style.color = color

  let currentSpecies = normalizeSpecies(species)
  let currentDirection = 'down' // 기본은 화면(카메라) 쪽을 보는 정지 자세
  let currentFrame = 0
  let isWalking = false
  let walkTimer = null

  function render() {
    spriteEl.src = spritePath(currentSpecies, currentDirection, currentFrame)
  }

  function startWalkAnim() {
    if (walkTimer) return
    walkTimer = setInterval(() => {
      currentFrame = currentFrame === 0 ? 1 : 0
      render()
    }, WALK_FRAME_INTERVAL_MS)
  }

  function stopWalkAnim() {
    if (walkTimer) {
      clearInterval(walkTimer)
      walkTimer = null
    }
    currentFrame = 0
    render()
  }

  render()

  if (isLocal) {
    el.addEventListener('mouseenter', () => {
      window.petAPI.setIgnoreMouseEvents(false)
    })
    el.addEventListener('mouseleave', () => {
      window.petAPI.setIgnoreMouseEvents(true, { forward: true })
    })
    el.addEventListener('click', () => {
      onClick?.()
    })
  }

  container.appendChild(el)

  let bubbleTimer = null

  return {
    el,
    setPosition(x, y) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    },
    // direction: 'up' | 'down' | 'left' | 'right' — 안 주거나 모르는 값이면 방향 유지
    setDirection(direction) {
      if ((direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right') && direction !== currentDirection) {
        currentDirection = direction
        render()
      }
    },
    setWalking(walking) {
      el.classList.toggle('walking', !!walking)
      if (walking && !isWalking) {
        isWalking = true
        startWalkAnim()
      } else if (!walking && isWalking) {
        isWalking = false
        stopWalkAnim()
      }
    },
    setSpecies(newSpecies) {
      const normalized = normalizeSpecies(newSpecies)
      if (normalized !== currentSpecies) {
        currentSpecies = normalized
        render()
      }
    },
    setNickname(text, colorValue) {
      nicknameEl.textContent = text
      if (colorValue) nicknameEl.style.color = colorValue
    },
    showBubble(text, durationMs = 2500) {
      bubbleEl.textContent = text
      bubbleEl.classList.add('visible')
      if (bubbleTimer) clearTimeout(bubbleTimer)
      bubbleTimer = setTimeout(() => {
        bubbleEl.classList.remove('visible')
      }, durationMs)
    },
    destroy() {
      if (bubbleTimer) clearTimeout(bubbleTimer)
      stopWalkAnim()
      el.remove()
    },
  }
}

// 닉네임(또는 participantId) 기반 고정 색상 — 같은 텍스트는 항상 같은 색이 나옴.
// Phase 4 채팅의 "닉네임 색상 구분"에도 그대로 재사용할 예정.
export function colorForText(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue}, 65%, 42%)`
}
