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
  roomInactivityTimeoutMs: intFromEnv('ROOM_INACTIVITY_TIMEOUT_MS', 30 * 60 * 1000),
  heartbeatIntervalMs: intFromEnv('HEARTBEAT_INTERVAL_MS', 30 * 1000),
}
