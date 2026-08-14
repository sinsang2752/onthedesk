// 환경변수로 관리하는 설정값들 (REQUIREMENTS.md 5번 참고)
function intFromEnv(name, defaultValue) {
  const raw = process.env[name]
  if (!raw) return defaultValue
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

module.exports = {
  port: intFromEnv('PORT', 8080),
  maxParticipants: intFromEnv('ROOM_MAX_PARTICIPANTS', 8),
  heartbeatIntervalMs: intFromEnv('HEARTBEAT_INTERVAL_MS', 30 * 1000),
  // 참여자가 0명이 된 방을 "즉시" 지우지 않고 잠깐 유예를 주는 시간 (= 방 비활성 정리 시간).
  // 클라이언트가 방을 만든 직후 잠깐 연결을 끊었다가 곧바로 다시 join하는 정상적인
  // 흐름(런처 창에서 확인 후 실제 캐릭터 창이 새로 접속하는 구조)이 있어서 필요함.
  emptyRoomGraceMs: intFromEnv('EMPTY_ROOM_GRACE_MS', 15 * 1000),
  // 참여 코드 무작위 대입(brute force) 방지 (3.7): 같은 IP에서 이 시간(ms) 동안
  // 이 횟수를 넘겨 join-room을 시도하면 잠깐 차단한다.
  joinRateLimitWindowMs: intFromEnv('JOIN_RATE_LIMIT_WINDOW_MS', 10 * 1000),
  joinRateLimitMax: intFromEnv('JOIN_RATE_LIMIT_MAX', 10),
}
