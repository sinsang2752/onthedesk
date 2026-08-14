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
  // 참여자가 0명인 방을 "즉시" 지우지 않고 유예를 주는 시간.
  // 방을 막 만든 시점에는 참여자가 0명인 게 정상이다(런처는 코드만 보여주고 연결을
  // 끊기 때문 — create-room 처리부 주석 참고). 이 시간 안에 아무도(방을 만든 사람의
  // 캐릭터 창조차, 초대받은 사람도) join하지 않아야만 실제로 삭제된다.
  // 너무 짧으면 "코드를 친구에게 알려주고 친구가 입력할 때까지"의 실제 소요 시간보다
  // 먼저 방이 지워져서 정상적인 참여 코드가 "존재하지 않음"으로 뜨는 버그가 생기므로
  // (실사용 중 발견됨) 사람이 코드를 공유하는 데 걸리는 시간을 넉넉히 잡는다.
  emptyRoomGraceMs: intFromEnv('EMPTY_ROOM_GRACE_MS', 10 * 60 * 1000),
  // 참여 코드 무작위 대입(brute force) 방지 (3.7): 같은 IP에서 이 시간(ms) 동안
  // 이 횟수를 넘겨 join-room을 시도하면 잠깐 차단한다.
  joinRateLimitWindowMs: intFromEnv('JOIN_RATE_LIMIT_WINDOW_MS', 10 * 1000),
  joinRateLimitMax: intFromEnv('JOIN_RATE_LIMIT_MAX', 10),
}
