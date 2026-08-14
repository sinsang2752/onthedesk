// 시그널링 클라이언트 + WebRTC 메시(mesh) 연결 관리 (2.2, 3.2).
//
// 방 참여/퇴장, SDP/ICE 중계는 시그널링 서버(WebSocket)를 거치고, 연결이 맺어진 뒤의
// 실제 이동/채팅 이벤트는 여기서 만든 RTCDataChannel로 참여자끼리 직접 주고받는다.
//
// 보안 메모(3.7): onPeerMessage(peerId, msg)의 peerId는 메시지 payload 안에 있는
// 어떤 자기 신고 값도 아니고, "이 메시지가 실제로 어느 RTCPeerConnection(DataChannel)을
// 통해 들어왔는가"로 결정된다. 즉 다른 참여자 행세를 하는 위장 메시지를 만들 방법이
// 애초에 없다 — 상대의 DataChannel 자체가 신원이기 때문.

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
// TURN(Open Relay/Metered)은 실제로 직접 연결이 안 되는 네트워크가 확인되면 나중에 추가

export function createNetworkSession({ signalingServerUrl, roomCode, nickname, species, handlers = {} }) {
  const { onJoined, onPeerJoined, onPeerLeft, onPeerMessage, onError } = handlers

  let ws = null
  let myParticipantId = null
  const peers = new Map() // peerId -> { pc, dc, nickname, species, dcOpen }
  const pendingPeerInfo = new Map() // peer-joined로 먼저 알게 된 닉네임/종 (offer 도착 전 보관)

  function sendJson(target, obj) {
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(JSON.stringify(obj))
    }
  }

  function createPeerConnection(peerId, peerNickname, peerSpecies) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry = { pc, dc: null, nickname: peerNickname, species: peerSpecies, dcOpen: false }
    peers.set(peerId, entry)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendJson(ws, { type: 'signal', to: peerId, data: { kind: 'ice-candidate', payload: event.candidate } })
      }
    }

    pc.ondatachannel = (event) => {
      attachDataChannel(peerId, entry, event.channel)
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeer(peerId)
      }
    }

    return entry
  }

  function attachDataChannel(peerId, entry, channel) {
    entry.dc = channel
    channel.onopen = () => {
      entry.dcOpen = true
      onPeerJoined?.(peerId, entry.nickname, entry.species)
    }
    channel.onclose = () => {
      entry.dcOpen = false
    }
    channel.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      onPeerMessage?.(peerId, msg)
    }
  }

  async function initiateConnectionTo(peerId, peerNickname, peerSpecies) {
    const entry = createPeerConnection(peerId, peerNickname, peerSpecies)
    const channel = entry.pc.createDataChannel('game')
    attachDataChannel(peerId, entry, channel)

    const offer = await entry.pc.createOffer()
    await entry.pc.setLocalDescription(offer)
    sendJson(ws, { type: 'signal', to: peerId, data: { kind: 'offer', payload: offer } })
  }

  function removePeer(peerId) {
    const entry = peers.get(peerId)
    if (!entry) return
    peers.delete(peerId)
    try {
      entry.dc?.close()
    } catch {
      // 무시 — 이미 닫혔거나 정리 중일 수 있음
    }
    try {
      entry.pc.close()
    } catch {
      // 무시
    }
    onPeerLeft?.(peerId)
  }

  async function handleSignal(fromPeerId, data) {
    let entry = peers.get(fromPeerId)

    if (data.kind === 'offer') {
      if (!entry) {
        const info = pendingPeerInfo.get(fromPeerId) || {}
        pendingPeerInfo.delete(fromPeerId)
        entry = createPeerConnection(fromPeerId, info.nickname || '', info.species)
      }
      await entry.pc.setRemoteDescription(data.payload)
      const answer = await entry.pc.createAnswer()
      await entry.pc.setLocalDescription(answer)
      sendJson(ws, { type: 'signal', to: fromPeerId, data: { kind: 'answer', payload: answer } })
    } else if (data.kind === 'answer') {
      if (entry) await entry.pc.setRemoteDescription(data.payload)
    } else if (data.kind === 'ice-candidate') {
      if (entry) {
        try {
          await entry.pc.addIceCandidate(data.payload)
        } catch {
          // 이미 닫혔거나 중복 후보 등 — 대부분 무해하게 무시 가능
        }
      }
    }
  }

  function handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'joined': {
        myParticipantId = msg.participantId
        onJoined?.(msg.participantId)
        for (const p of msg.participants) {
          initiateConnectionTo(p.id, p.nickname, p.species)
        }
        break
      }
      case 'peer-joined': {
        // 상대가 나에게 offer를 보내올 것이므로 여기서는 아직 RTCPeerConnection을 만들지
        // 않고, 닉네임/종만 미리 기억해둔다 (offer 도착 시 createPeerConnection에서 사용).
        pendingPeerInfo.set(msg.participantId, { nickname: msg.nickname, species: msg.species })
        break
      }
      case 'peer-left': {
        pendingPeerInfo.delete(msg.participantId)
        removePeer(msg.participantId)
        break
      }
      case 'signal': {
        handleSignal(msg.from, msg.data)
        break
      }
      case 'error': {
        onError?.(msg.code)
        break
      }
      default:
        break
    }
  }

  function connect() {
    ws = new WebSocket(signalingServerUrl)

    ws.onopen = () => {
      sendJson(ws, { type: 'join-room', roomCode, nickname, species })
    }
    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      handleSignalingMessage(msg)
    }
    ws.onerror = () => {
      onError?.('WS_ERROR')
    }
    ws.onclose = () => {
      // 시그널링 서버 연결이 끊겨도 이미 맺어진 P2P 연결(DataChannel)은 계속 유지된다
      // (2.2 — 연결이 맺어지면 서버는 더 이상 관여하지 않음). 완전한 자동 재연결은
      // 이번 단계에서는 만들지 않음(설계 이슈 3 — 필요해지면 나중에 보강).
    }
  }

  connect()

  return {
    get myParticipantId() {
      return myParticipantId
    },
    broadcast(message) {
      const json = JSON.stringify(message)
      for (const entry of peers.values()) {
        if (entry.dcOpen && entry.dc) entry.dc.send(json)
      }
    },
    sendTo(peerId, message) {
      const entry = peers.get(peerId)
      if (entry?.dcOpen && entry.dc) entry.dc.send(JSON.stringify(message))
    },
    disconnect() {
      for (const peerId of [...peers.keys()]) removePeer(peerId)
      try {
        ws?.close()
      } catch {
        // 무시
      }
    },
  }
}
