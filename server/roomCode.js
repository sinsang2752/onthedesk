const crypto = require('crypto')

// 헷갈리기 쉬운 문자(0/O, 1/I/L) 제외 — 32종 문자
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

// 무작위 대입(brute force) 방지를 위해 Math.random이 아니라 crypto.randomInt 사용 (3.7 참고)
function generateRoomCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)]
  }
  return code
}

module.exports = { generateRoomCode, ALPHABET, CODE_LENGTH }
