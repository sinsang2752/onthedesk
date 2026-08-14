// 좌표 정규화 유틸 (3.4) — 참여자마다 모니터 해상도가 다르므로, 네트워크로 주고받는 위치는
// 항상 화면 크기 대비 비율(0~1)로 변환한다. y는 "화면 하단이 기준(0)"이 되게 뒤집어서,
// 해상도가 달라도 캐릭터가 항상 바닥에 서 있는 것처럼 보이게 한다.

export function toNormalized(x, y) {
  return {
    nx: x / window.innerWidth,
    ny: (window.innerHeight - y) / window.innerHeight,
  }
}

export function fromNormalized(nx, ny) {
  return {
    x: nx * window.innerWidth,
    y: window.innerHeight - ny * window.innerHeight,
  }
}
