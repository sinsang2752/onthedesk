// 시그널링 클라이언트 + WebRTC 메시(mesh) 연결 관리 (2.2, 3.2).
//
// 방 참여/퇴장, SDP/ICE 중계는 시그널링 서버(WebSocket)를 거치고, 연결이 맺어진 뒤의
// 실제 이동/채팅 이벤트는 여기서 만든 RTCDataChannel로 참여자끼리 직접 주고받는다.
//
// 상대(peer) 하나당 DataChannel을 2개 만든다 — 성격이 정반대라서 하나로 합치면 문제가 생긴다:
//   - 'chat'  : 기본 설정(ordered+reliable, TCP처럼 재전송 보장). 메시지 유실/순서 뒤바뀜이
//               절대 안 되는 채팅 텍스트, 그리고 새로 연결된 상대에게 보내는 최초 상태
//               동기화(sendTo)에 쓴다.
//   - 'state' : { ordered: false, maxRetransmits: 0 } — 위치 이벤트(move-start/move-stop)는
//               "최신 값이 곧 정답"이라 패킷 하나가 유실돼도 다음 이벤트가 알아서 덮어쓴다.
//               그런데 이걸 신뢰 채널로 보내면, 패킷 하나가 유실될 때 그걸 재전송할 때까지
//               뒤에 도착한 멀쩡한 이벤트들까지 전부 대기 행렬에 묶여버리고(head-of-line
//               blocking), 재전송이 끝나면 밀린 이벤트가 한꺼번에 몰려 처리되면서 캐릭터가
//               멈칫하다 튀는 것처럼 보인다. 유실을 허용하는 채널로 분리해서 이 문제를 없앤다.
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
  const peers = new Map() // peerId -> { pc, chatDc, chatOpen, stateDc, stateOpen, nickname, species }
  const pendingPeerInfo = new Map() // peer-joined로 먼저 알게 된 닉네임/종 (offer 도착 전 보관)

  function sendJson(target, obj) {
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(JSON.stringify(obj))
    }
  }

  function createPeerConnection(peerId, peerNickname, peerSpecies) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry = {
      pc,
      chatDc: null,
      chatOpen: false,
      stateDc: null,
      stateOpen: false,
      nickname: peerNickname,
      species: peerSpecies,
    }
    peers.set(peerId, entry)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendJson(ws, { type: 'signal', to: peerId, data: { kind: 'ice-candidate', payload: event.candidate } })
      }
    }

    // 상대가 만든 채널 2개(chat, state)가 각각 별도의 ondatachannel 이벤트로 도착한다.
    // 어느 쪽인지는 channel.label로 구분한다.
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
    const isChat = channel.label === 'chat'

    if (isChat) entry.chatDc = channel
    else entry.stateDc = channel

    channel.onopen = () => {
      if (isChat) {
        entry.chatOpen = true
        // 캐릭터 생성은 채팅(신뢰) 채널이 열린 시점 기준 한 번만 알린다.
        onPeerJoined?.(peerId, entry.nickname, entry.species)
      } else {
        entry.stateOpen = true
      }
    }
    channel.onclose = () => {
      if (isChat) entry.chatOpen = false
      else entry.stateOpen = false
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
    const chatChannel = entry.pc.createDataChannel('chat')
    const stateChannel = entry.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 })
    attachDataChannel(peerId, entry, chatChannel)
    attachDataChannel(peerId, entry, stateChannel)

    const offer = await entry.pc.createOffer()
    await entry.pc.setLocalDescription(offer)
    sendJson(ws, { type: 'signal', to: peerId, data: { kind: 'offer', payload: offer } })
  }

  function removePeer(peerId) {
    const entry = peers.get(peerId)
    if (!entry) return
    peers.delete(peerId)
    try {
      entry.chatDc?.close()
    } catch {
      // 무시 — 이미 닫혔거나 정리 중일 수 있음
    }
    try {
      entry.stateDc?.close()
    } catch {
      // 무시
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
    // 채팅처럼 반드시 도착해야 하고 순서도 맞아야 하는 메시지 — 'chat' 채널(신뢰) 사용.
    broadcastChat(message) {
      const json = JSON.stringify(message)
      for (const entry of peers.values()) {
        if (entry.chatOpen && entry.chatDc) entry.chatDc.send(json)
      }
    },
    // 위치 이벤트처럼 유실을 허용해도 되는(최신 값이 곧 정답인) 메시지 — 'state' 채널(유실
    // 허용) 사용. 재전송 대기로 인한 head-of-line blocking을 피해서 끊김 없이 부드럽다.
    broadcastState(message) {
      const json = JSON.stringify(message)
      for (const entry of peers.values()) {
        if (entry.stateOpen && entry.stateDc) entry.stateDc.send(json)
      }
    },
    // 새로 연결된 상대에게 보내는 최초 상태 동기화(1회성) — 유실되면 상대 화면에 내
    // 캐릭터가 계속 잘못된 위치로 보이므로, 'chat' 채널(신뢰)로 보낸다.
    sendTo(peerId, message) {
      const entry = peers.get(peerId)
      if (entry?.chatOpen && entry.chatDc) entry.chatDc.send(JSON.stringify(message))
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
