/**
 * VanishText {Made by SUVX}
 * Transport & Signaling Layer
 *
 * Implements:
 * 1. ServerSignalingTransport (Primary trusted server-side coordinator with WebRTC STUN/TURN relay)
 * 2. PeerJS WebRTC Transport (Direct peer-to-peer data channel)
 * 3. BroadcastChannel Transport (Zero-setup local development & testing between tabs)
 *
 * Enforces:
 * - Cross-network communication with STUN and TURN relay support
 * - Strict 1-to-1 admission control (creator + 1 admitted guest at a time; rejects 3rd participant)
 * - Creator-only authenticated actions (admit guest, remove guest, revoke access)
 * - Synchronized CLEAR CHAT FOR BOTH with timestamp cutoff
 * - Genuine End-to-End Encryption (AES-256-GCM + ECDH P-256) across direct, relayed, and fallback transports
 * - No plaintext ever traverses the network or reaches the server
 */

(function (window) {
  'use strict';

  class BaseTransport {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.role = null; // 'creator' | 'guest'
      this.roomId = null;
      this.nickname = null;
      this.participantId = null;
      this.roomType = 'direct';
      this.maxParticipants = 2;
      this._incomingChunks = new Map();
      this.iceServers = null;
      this.iceTransportPolicy = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.forceTurnRelay) ? 'relay' : 'all';
    }

    async _fetchTurnCredentials() {
      try {
        const forceRelay = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.forceTurnRelay) || false;
        const apiUrl = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.turnApiUrl) || '/api/turn-credentials';
        const url = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}mode=${forceRelay ? 'relay' : 'all'}`;

        if (typeof fetch === 'function') {
          let timeoutId = null;
          let fetchPromise;
          if (typeof AbortController !== 'undefined') {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 2000);
            fetchPromise = fetch(url, { signal: controller.signal });
          } else {
            fetchPromise = fetch(url);
          }
          const res = await fetchPromise;
          if (timeoutId) clearTimeout(timeoutId);
          if (res && res.ok) {
            const data = await res.json();
            if (data.iceServers && Array.isArray(data.iceServers)) {
              this.iceServers = data.iceServers;
            }
            if (data.iceTransportPolicy) {
              this.iceTransportPolicy = data.iceTransportPolicy;
            }
            return data;
          }
        }
      } catch (e) {
        console.warn('[Transport] Dynamic TURN credentials fetch skipped or unavailable:', e.message);
      }
      return null;
    }

    getParticipantId() {
      return this.participantId || this.role || 'self';
    }

    _handleIncomingChunk(chunkMsg, onComplete) {
      if (!chunkMsg || !chunkMsg.chunkId || typeof chunkMsg.index !== 'number' || typeof chunkMsg.total !== 'number') return;
      const { chunkId, index, total, data } = chunkMsg;

      let entry = this._incomingChunks.get(chunkId);
      if (!entry) {
        entry = {
          total: total,
          received: 0,
          parts: new Array(total),
          timer: setTimeout(() => {
            console.warn('[Transport] Chunk assembly timeout for chunkId:', chunkId);
            this._incomingChunks.delete(chunkId);
          }, 120000) // 2 min: handles slow TURN relay or mobile for large image chunks
        };
        this._incomingChunks.set(chunkId, entry);
      }

      if (entry.parts[index] === undefined) {
        entry.parts[index] = data || '';
        entry.received += 1;
      }

      if (entry.received >= entry.total) {
        clearTimeout(entry.timer);
        this._incomingChunks.delete(chunkId);
        try {
          const fullJsonStr = entry.parts.join('');
          let assembled = JSON.parse(fullJsonStr);
          // If chunked data was an encrypted payload directly { iv, ciphertext, seq }
          if (assembled && assembled.iv && assembled.ciphertext && !assembled.type) {
            assembled = {
              type: 'ENCRYPTED_MESSAGE',
              payload: assembled,
              senderId: chunkMsg.senderId,
              senderNick: chunkMsg.senderNick,
              timestamp: chunkMsg.timestamp || Date.now()
            };
          }
          if (typeof onComplete === 'function') {
            onComplete(assembled);
          }
        } catch (err) {
          console.error('[Transport Chunk Reassembly Error]', err);
        }
      }
    }

    emit(event, ...args) {
      if (this.callbacks[event]) {
        try {
          this.callbacks[event](...args);
        } catch (err) {
          console.error(`[Transport Error] Exception in callback for ${event}:`, err);
        }
      }
    }

    emitState(state, details = {}) {
      if (this.callbacks) {
        if (typeof this.callbacks.onStateChange === 'function') {
          try {
            this.callbacks.onStateChange(state, details);
          } catch (err) {
            console.error(`[Transport Error] Exception in onStateChange for ${state}:`, err);
          }
        }
        const eventName = 'on' + state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
        if (typeof this.callbacks[eventName] === 'function') {
          try {
            this.callbacks[eventName](details);
          } catch (err) {
            console.error(`[Transport Error] Exception in callback for ${eventName}:`, err);
          }
        }
      }
    }

    admitGuest(guestId) {}
    rejectGuest(guestId) {}
    removeGuest() {}
    clearChatForBoth() {}
  }

  /**
   * 1. ServerSignalingTransport
   * Trusted Server-Coordinated Transport with WebRTC STUN/TURN Relay Support
   */
  class ServerSignalingTransport extends BaseTransport {
    constructor(callbacks) {
      super(callbacks);
      this.ws = null;
      this.pc = null;
      this.dataChannel = null;
      this.creatorSecret = null;
      this.guestToken = null;
      this.guestId = null;
      this.publicKeyJwk = null;
      this.roomCreatedAt = null;
      this.transportName = 'WebRTC DataChannel (STUN/TURN Relay)';
      this.iceServers = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.webrtc && window.CHATSPACE_CONFIG.webrtc.iceServers) || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ];
      this.iceTransportPolicy = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.forceTurnRelay) ? 'relay' : 'all';
      this.candidateTypes = new Set();
      this._iceCandidateQueue = [];
      this._incomingChunks = new Map();
      this._sessionEstablished = false;
      this._destroyed = false;
    }

    async _fetchTurnCredentials() {
      // Zero external API calls: use local in-memory configuration directly
      this.iceServers = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.webrtc && window.CHATSPACE_CONFIG.webrtc.iceServers) || [];
      this.iceTransportPolicy = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.forceTurnRelay) ? 'relay' : 'all';
    }

    _resolveWsUrl() {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        try {
          const params = new URLSearchParams(window.location.search);
          const sParam = params.get('server') || params.get('ws');
          if (sParam) return sParam;
        } catch (e) {}
      }
      if (typeof window !== 'undefined' && window.VANISHTEXT_SERVER_URL) {
        return window.VANISHTEXT_SERVER_URL;
      }
      if (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.serverUrl) {
        return window.CHATSPACE_CONFIG.signaling.serverUrl;
      }
      if (typeof window !== 'undefined' && window.location && window.location.host && window.location.protocol !== 'file:') {
        const host = (window.location.host || '').toLowerCase();
        const isStaticDeploy = host.endsWith('.vercel.app') ||
                               host.endsWith('.netlify.app') ||
                               host.endsWith('.github.io') ||
                               host.endsWith('.pages.dev');
        if (isStaticDeploy) {
          // Static serverless hosting does not support persistent WebSocket connections
          return null;
        }
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws`;
      }
      return 'ws://localhost:8080/ws';
    }

    async initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType = 'direct', maxParticipants = 2) {
      this.role = role;
      this.roomId = cleanCode;
      this.nickname = nickname;
      this.publicKeyJwk = publicKeyJwk;
      this.roomCreatedAt = roomCreatedAt || Date.now();
      this.roomType = roomType || 'direct';
      this.maxParticipants = maxParticipants || 2;

      // 1. Fetch secure, temporary STUN/TURN relay credentials with timeout
      await this._fetchTurnCredentials();

      // 2. Connect to trusted WebSocket coordinator
      const wsUrl = this._resolveWsUrl();
      if (!wsUrl) {
        throw new Error('Static host detected without external WebSocket signaling server.');
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const connectTimeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            if (this.ws) {
              try { this.ws.close(); } catch (e) {}
            }
            reject(new Error('Signaling server connection timeout.'));
          }
        }, 3500);

        try {
          const WSConstructor = (typeof window !== 'undefined' && window.WebSocket)
            ? window.WebSocket
            : (typeof require !== 'undefined' ? require('ws') : null);

          if (!WSConstructor) {
            clearTimeout(connectTimeout);
            reject(new Error('WebSocket is not available in this environment.'));
            return;
          }

          this.ws = new WSConstructor(wsUrl);

          this.ws.onopen = () => {
            this._setupWebSocketHandlers((msg) => {
              if (!settled) {
                if (msg.type === 'ROOM_CREATED' || msg.type === 'WAITING_FOR_ADMISSION') {
                  settled = true;
                  clearTimeout(connectTimeout);
                  resolve();
                } else if (msg.type === 'ERROR' || msg.type === 'ROOM_FULL') {
                  settled = true;
                  clearTimeout(connectTimeout);
                  reject(new Error(msg.error || msg.message || 'Server rejected room creation.'));
                }
              }
            });

            if (this.role === 'creator') {
              this.ws.send(JSON.stringify({
                type: 'CREATE_ROOM',
                roomId: this.roomId,
                nickname: this.nickname,
                jwk: this.publicKeyJwk
              }));
            } else {
              this.ws.send(JSON.stringify({
                type: 'REQUEST_ADMISSION',
                roomId: this.roomId,
                nickname: this.nickname,
                jwk: this.publicKeyJwk
              }));
            }
          };

          this.ws.onerror = (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(connectTimeout);
              reject(new Error('Failed to connect to trusted signaling server at ' + wsUrl));
            }
          };

          this.ws.onclose = () => {
            if (!settled) {
              settled = true;
              clearTimeout(connectTimeout);
              reject(new Error('Signaling server connection closed before room creation.'));
            }
          };
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimeout(connectTimeout);
            reject(e);
          }
        }
      });
    }

    _setupWebSocketHandlers(onInitHook) {
      this.ws.onmessage = async (event) => {
        let msg;
        try {
          msg = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(event.data.toString());
        } catch (e) {
          return;
        }

        switch (msg.type) {
          case 'ROOM_CREATED':
            this._sessionEstablished = true;
            this.creatorSecret = msg.creatorSecret;
            this.participantId = msg.creatorId;
            this.emit('onReady', { transport: this.transportName, role: 'creator', code: this.roomId });
            if (typeof onInitHook === 'function') onInitHook(msg);
            break;

          case 'WAITING_FOR_ADMISSION':
            this.guestId = msg.guestId;
            this.participantId = msg.guestId;
            this.emit('onReady', { transport: this.transportName, role: 'guest', code: this.roomId });
            this.emit('onWaitingForAdmission', { message: msg.message });
            if (typeof onInitHook === 'function') onInitHook(msg);
            break;

          case 'ADMISSION_REQUEST':
            this.emit('onAdmissionRequest', { guestId: msg.guestId, nickname: msg.nickname });
            break;

          case 'ADMISSION_REJECTED':
            this.emit('onAdmissionRejected', msg.message || 'Admission request was declined.');
            this.destroy();
            break;

          case 'ROOM_FULL':
            this.emit('onRoomFull', msg.message || 'This room is full. Only two participants are allowed.');
            if (typeof onInitHook === 'function') onInitHook(msg);
            this.destroy();
            break;

          case 'ADMISSION_GRANTED':
            this._sessionEstablished = true;
            this.guestToken = msg.guestToken;
            this.roomCreatedAt = msg.roomCreatedAt;
            this.emit('onConnected');
            this.emit('onHandshakeReceived', {
              senderId: 'creator',
              nickname: msg.creatorNickname,
              role: 'creator',
              jwk: msg.creatorPublicKey,
              roomCreatedAt: msg.roomCreatedAt,
              roomType: 'direct',
              maxParticipants: 2,
              participantCount: 2
            });
            break;

          case 'GUEST_ADMITTED':
            this._sessionEstablished = true;
            this.admittedGuestId = msg.guestId;
            this.emit('onConnected');
            this.emit('onHandshakeReceived', {
              senderId: msg.guestId,
              nickname: msg.nickname,
              role: 'guest',
              jwk: msg.guestPublicKey,
              roomCreatedAt: this.roomCreatedAt,
              roomType: 'direct',
              maxParticipants: 2,
              participantCount: 2
            });
            // As creator, negotiate WebRTC PeerConnection with STUN/TURN
            this._initiateWebRtcOffer();
            break;

          case 'REMOVED_BY_CREATOR':
            this.emit('onRemovedByCreator', msg.message || 'You were removed from the room by the creator.');
            this.destroy();
            break;

          case 'GUEST_REMOVED':
            this.emit('onPeerLeft', { nickname: msg.nickname || 'Guest', message: msg.message, participantId: msg.guestId });
            this._teardownWebRtc();
            break;

          case 'GUEST_LEFT':
            this.emit('onPeerLeft', { nickname: msg.nickname || 'Guest', message: msg.message, participantId: msg.guestId });
            this._teardownWebRtc();
            break;

          case 'PARTICIPANT_JOINED':
            this.emit('onParticipantJoined', {
              participantId: msg.participantId,
              nickname: msg.nickname,
              count: msg.participantCount
            });
            break;

          case 'PARTICIPANT_LEFT':
            this.emit('onPeerLeft', {
              participantId: msg.participantId,
              nickname: msg.nickname,
              count: msg.participantCount
            });
            break;

          case 'CREATOR_DISCONNECTED':
            this.emit('onDisconnected', msg.message || 'Room creator has disconnected.');
            this.destroy();
            break;

          case 'CHAT_CLEARED':
            this.emit('onChatCleared', { clearedAt: msg.clearedAt, clearedBy: msg.clearedBy });
            break;

          case 'SIGNAL':
            this._handleWebRtcSignal(msg.signalData);
            break;

          case 'ENCRYPTED_MESSAGE':
            this.emit('onEncryptedMessage', msg);
            break;

          case 'ENCRYPTED_CHUNK':
            this._handleIncomingChunk(msg, (assembled) => {
              this.emit('onEncryptedMessage', assembled);
            });
            break;

          case 'ROOM_EXPIRED':
            this.emit('onRoomExpired', msg.message || 'Room has expired.');
            this.destroy();
            break;

          case 'ERROR':
            this.emit('onError', new Error(msg.error || 'Server error.'));
            break;
        }
      };

      this.ws.onclose = () => {
        if (!this._destroyed && this._sessionEstablished) {
          this.emit('onDisconnected', 'Signaling connection closed.');
        }
      };
    }

    async _initiateWebRtcOffer() {
      if (typeof window === 'undefined' || !window.RTCPeerConnection) return;
      try {
        this.pc = new window.RTCPeerConnection({
          iceServers: this.iceServers,
          iceTransportPolicy: this.iceTransportPolicy || 'all',
          iceCandidatePoolSize: 10
        });

        this._bindPcEvents();

        this.dataChannel = this.pc.createDataChannel('vt-chat', { ordered: true });
        this._bindDataChannelEvents(this.dataChannel);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'SIGNAL',
            roomId: this.roomId,
            creatorSecret: this.creatorSecret,
            guestToken: this.guestToken,
            targetGuestId: this.admittedGuestId,
            signalData: { desc: this.pc.localDescription }
          }));
        }
      } catch (e) {
        console.warn('[ServerTransport] WebRTC offer setup error, falling back to secure encrypted WebSocket relay:', e);
      }
    }

    async _drainIceCandidateQueue() {
      if (!this.pc || !this.pc.remoteDescription) return;
      while (this._iceCandidateQueue.length > 0) {
        const candidate = this._iceCandidateQueue.shift();
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[ServerTransport] Failed to add queued ICE candidate:', e.message);
        }
      }
    }

    async _handleWebRtcSignal(signalData) {
      if (!signalData || typeof window === 'undefined' || !window.RTCPeerConnection) return;
      try {
        if (signalData.desc) {
          const desc = signalData.desc;
          if (desc.type === 'offer') {
            this.pc = new window.RTCPeerConnection({
              iceServers: this.iceServers,
              iceTransportPolicy: this.iceTransportPolicy || 'all',
              iceCandidatePoolSize: 10
            });
            this._bindPcEvents();
            this.pc.ondatachannel = (e) => {
              this.dataChannel = e.channel;
              this._bindDataChannelEvents(this.dataChannel);
            };

            await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
            await this._drainIceCandidateQueue();

            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({
                type: 'SIGNAL',
                roomId: this.roomId,
                creatorSecret: this.creatorSecret,
                guestToken: this.guestToken,
                signalData: { desc: this.pc.localDescription }
              }));
            }
          } else if (desc.type === 'answer') {
            if (this.pc) {
              await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
              await this._drainIceCandidateQueue();
            }
          }
        } else if (signalData.candidate) {
          if (this.pc && this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
          } else {
            this._iceCandidateQueue.push(signalData.candidate);
          }
        }
      } catch (err) {
        console.warn('[ServerTransport] WebRTC signal handling error:', err);
      }
    }

    _bindPcEvents() {
      this.pc.onicecandidate = (e) => {
        if (e.candidate) {
          if (e.candidate.type) this.candidateTypes.add(e.candidate.type);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'SIGNAL',
              roomId: this.roomId,
              creatorSecret: this.creatorSecret,
              guestToken: this.guestToken,
              targetGuestId: this.admittedGuestId,
              signalData: { candidate: e.candidate }
            }));
          }
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
          const isRelayed = this.iceTransportPolicy === 'relay' || this.candidateTypes.has('relay');
          this.transportName = isRelayed ? 'WebRTC (TURN Relayed)' : 'WebRTC DataChannel (Direct P2P)';
          this.emit('onConnected');
        }
      };
    }

    _bindDataChannelEvents(channel) {
      channel.onopen = () => {
        const isRelayed = this.iceTransportPolicy === 'relay' || this.candidateTypes.has('relay');
        this.transportName = isRelayed ? 'WebRTC (TURN Relayed)' : 'WebRTC DataChannel (Direct P2P)';
        this.emit('onConnected');
      };

      channel.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ENCRYPTED_MESSAGE') {
            this.emit('onEncryptedMessage', data);
          } else if (data.type === 'ENCRYPTED_CHUNK') {
            this._handleIncomingChunk(data, (assembled) => {
              this.emit('onEncryptedMessage', assembled);
            });
          } else if (data.type === 'CLEAR_CHAT') {
            this.emit('onChatCleared', data);
          }
        } catch (e) {
          console.warn('[DataChannel message parse error]', e);
        }
      };
    }

    _teardownWebRtc() {
      if (this.dataChannel) {
        try { this.dataChannel.close(); } catch (e) {}
        this.dataChannel = null;
      }
      if (this.pc) {
        try { this.pc.close(); } catch (e) {}
        this.pc = null;
      }
      this.candidateTypes.clear();
      this._iceCandidateQueue = [];
    }

    admitGuest(guestId) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.creatorSecret) {
        this.ws.send(JSON.stringify({
          type: 'ADMIT_GUEST',
          roomId: this.roomId,
          guestId: guestId,
          creatorSecret: this.creatorSecret
        }));
      }
    }

    rejectGuest(guestId) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.creatorSecret) {
        this.ws.send(JSON.stringify({
          type: 'REJECT_GUEST',
          roomId: this.roomId,
          guestId: guestId,
          creatorSecret: this.creatorSecret
        }));
      }
    }

    removeGuest(guestId) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.creatorSecret) {
        this.ws.send(JSON.stringify({
          type: 'REMOVE_GUEST',
          roomId: this.roomId,
          creatorSecret: this.creatorSecret,
          guestId: guestId || null
        }));
      }
      this._teardownWebRtc();
    }

    clearChatForBoth() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'CLEAR_CHAT',
          roomId: this.roomId,
          creatorSecret: this.creatorSecret,
          guestToken: this.guestToken
        }));
      }
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify({
            type: 'CLEAR_CHAT',
            clearedAt: Date.now(),
            clearedBy: this.nickname
          }));
        } catch (e) {}
      }
    }

    sendEncryptedMessage(payload, senderNickname, timestamp, customSenderId) {
      const senderId = customSenderId || this.participantId || this.role || 'self';
      const msg = {
        type: 'ENCRYPTED_MESSAGE',
        payload: payload,
        senderId: senderId,
        senderNick: senderNickname,
        timestamp: timestamp || Date.now()
      };

      const serialized = JSON.stringify(msg);
      const CHUNK_SIZE = 24576; // 24KB per chunk to ensure zero SCTP or WS frame truncation

      // 1. Direct WebRTC DataChannel (P2P or TURN Relay)
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        if (serialized.length <= CHUNK_SIZE) {
          this.dataChannel.send(serialized);
        } else {
          const chunkId = 'dc-chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE);
          for (let i = 0; i < totalChunks; i++) {
            this.dataChannel.send(JSON.stringify({
              type: 'ENCRYPTED_CHUNK',
              chunkId: chunkId,
              index: i,
              total: totalChunks,
              data: serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
              senderId: senderId,
              senderNick: senderNickname,
              timestamp: msg.timestamp
            }));
          }
        }
        return;
      }

      // 2. Encrypted fallback relay over WebSocket (Preserves 100% E2EE)
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (serialized.length <= CHUNK_SIZE) {
          this.ws.send(JSON.stringify({
            type: 'ENCRYPTED_MESSAGE',
            roomId: this.roomId,
            creatorSecret: this.creatorSecret,
            guestToken: this.guestToken,
            payload: payload,
            senderId: senderId,
            senderNick: senderNickname,
            timestamp: msg.timestamp
          }));
        } else {
          const chunkId = 'ws-chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE);
          for (let i = 0; i < totalChunks; i++) {
            this.ws.send(JSON.stringify({
              type: 'ENCRYPTED_CHUNK',
              chunkId: chunkId,
              index: i,
              total: totalChunks,
              data: serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
              roomId: this.roomId,
              creatorSecret: this.creatorSecret,
              guestToken: this.guestToken,
              senderId: senderId,
              senderNick: senderNickname,
              timestamp: msg.timestamp
            }));
          }
        }
        return;
      }

      throw new Error('No active transport channel available.');
    }

    notifyRoomExpired() {
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'ROOM_EXPIRED',
            roomId: this.roomId,
            creatorSecret: this.creatorSecret,
            guestToken: this.guestToken
          }));
        }
      } catch (e) {}
    }

    destroy() {
      this._destroyed = true;
      this._sessionEstablished = false;
      this._teardownWebRtc();
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
    }
  }

  /**
   * 2. PeerJS WebRTC Transport
   */
  class PeerJsTransport extends BaseTransport {
    constructor(callbacks) {
      super(callbacks);
      this.peer = null;
      this.conn = null;
      this.connections = new Map();
      this.candidateTypes = new Set();
      this.transportName = 'PeerJS WebRTC (Cross-Device P2P)';
      this._heartbeatInterval = null;
      this._destroyed = false;
      this._iceRestartAttempted = false;
    }

    _getIceServers() {
      if (this.iceServers && Array.isArray(this.iceServers) && this.iceServers.length > 0) {
        return this.iceServers;
      }
      const cfg = window.CHATSPACE_CONFIG;
      if (cfg && cfg.peerjs && cfg.peerjs.config && cfg.peerjs.config.iceServers) {
        return cfg.peerjs.config.iceServers;
      }
      if (cfg && cfg.webrtc && cfg.webrtc.iceServers) {
        return cfg.webrtc.iceServers;
      }
      return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:relay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:relay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turns:relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ];
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      this._heartbeatInterval = setInterval(() => {
        if (!this._destroyed && this.peer) {
          if (this.peer.disconnected && !this.peer.destroyed) {
            try { this.peer.reconnect(); } catch (e) {}
          }
          if (this.peer.socket && this.peer.socket._open) {
            try {
              this.peer.socket.send({ type: 'PING' });
            } catch (e) {}
          }
        }
      }, 7000);
      if (this._heartbeatInterval && typeof this._heartbeatInterval.unref === 'function') {
        this._heartbeatInterval.unref();
      }
    }

    _stopHeartbeat() {
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }
    }

    async initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType = 'direct', maxParticipants = 2) {
      this.role = role;
      this.roomId = cleanCode;
      this.nickname = nickname;
      this.participantId = `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      this.roomCreatedAt = roomCreatedAt || (window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now());
      this.roomType = roomType || 'direct';
      this.maxParticipants = maxParticipants || (roomType === 'group' ? 10 : 2);
      this._destroyed = false;
      this._iceRestartAttempted = false;
      this.candidateTypes = new Set();

      if (typeof window.Peer === 'undefined') {
        throw new Error('PeerJS library is not loaded.');
      }

      // Fetch dynamic TURN relay credentials from backend authority if available
      await this._fetchTurnCredentials();

      const hostPeerId = `vt-room-${cleanCode}-host`;
      const config = window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.peerjs ? window.CHATSPACE_CONFIG.peerjs : {};
      const iceServers = this._getIceServers();
      const iceTransportPolicy = this.iceTransportPolicy || 'all';

      if (role === 'creator') {
        this.emitState('SIGNALING', { message: 'Registering private room on peer network...' });
        return new Promise((resolve, reject) => {
          let settled = false;
          const peerTimeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              if (this.peer) {
                try { this.peer.destroy(); } catch (e) {}
              }
              this.emitState('FAILED', { error: 'Peer network connection timed out after 15s.' });
              reject(new Error('PeerJS host connection timed out.'));
            }
          }, 15000);

          try {
            this.peer = new window.Peer(hostPeerId, {
              host: config.host || '0.peerjs.com',
              port: config.port || 443,
              path: config.path || '/',
              secure: config.secure !== false,
              config: {
                iceServers: iceServers,
                iceTransportPolicy: iceTransportPolicy,
                iceCandidatePoolSize: 10
              }
            });

            this.peer.on('open', (id) => {
              if (!settled) {
                settled = true;
                clearTimeout(peerTimeout);
                this._startHeartbeat();
                this.emitState('SIGNALING', { message: 'Room ready. Waiting for guest to join...' });
                this.emit('onReady', { transport: this.transportName, role: 'creator', code: cleanCode });
                resolve();
              }
            });

            this.peer.on('disconnected', () => {
              console.warn('[PeerJS Creator] Disconnected from signaling broker, attempting reconnect...');
              if (!this._destroyed && this.peer && !this.peer.destroyed) {
                try { this.peer.reconnect(); } catch (e) {}
              }
            });

            this.peer.on('connection', (incomingConn) => {
              const now = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
              if (this.roomCreatedAt && (now - this.roomCreatedAt >= 3600000)) {
                incomingConn.on('open', () => {
                  try {
                    incomingConn.send({
                      type: 'ROOM_EXPIRED',
                      message: 'This room has reached its 1-hour expiration and is permanently disabled.'
                    });
                  } catch (e) {}
                  setTimeout(() => { try { incomingConn.close(); } catch(e){} }, 500);
                });
                return;
              }

              // Strict 1-to-1 admission control
              if (this.conn && this.conn.open && this.conn !== incomingConn) {
                // If it is the same guest peer reconnecting, replace the connection
                if (incomingConn.peer && this.conn.peer === incomingConn.peer) {
                  try { this.conn.close(); } catch (e) {}
                  this.conn = null;
                } else {
                  const rejectFull = () => {
                    try {
                      incomingConn.send({
                        type: 'ROOM_FULL',
                        message: 'This room is full. Only two participants are allowed.'
                      });
                    } catch (e) {}
                    setTimeout(() => { try { incomingConn.close(); } catch (e) {} }, 500);
                  };
                  if (incomingConn.open) rejectFull();
                  else incomingConn.on('open', rejectFull);
                  return;
                }
              }

              this.conn = incomingConn;
              this.emitState('NEGOTIATING', { message: 'Incoming connection from guest. Negotiating peer session...' });
              this._setupConnectionHandlers(incomingConn, publicKeyJwk);
            });

            this.peer.on('error', (err) => {
              if (!settled) {
                settled = true;
                clearTimeout(peerTimeout);
                if (err.type === 'unavailable-id') {
                  this.emitState('FAILED', { error: 'A room with this invitation code is already active.' });
                  reject(new Error('A room with this invitation code is already active.'));
                } else {
                  this.emitState('FAILED', { error: err.message || 'PeerJS host initialization failed.' });
                  reject(new Error(err.message || 'PeerJS host initialization failed.'));
                }
              }
            });
          } catch (initErr) {
            if (!settled) {
              settled = true;
              clearTimeout(peerTimeout);
              this.emitState('FAILED', { error: initErr.message });
              reject(initErr);
            }
          }
        });
      } else {
        // Guest mode
        this.emitState('CONNECTING', { message: 'Connecting to secure peer network...' });
        return new Promise((resolve, reject) => {
          let settled = false;
          let connectTimeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              const timeoutMsg = 'Connection timed out while locating room host. The host may be offline.';
              this.emitState('FAILED', { error: timeoutMsg });
              this.destroy();
              reject(new Error(timeoutMsg));
            }
          }, 40000);

          const guestPeerId = `vt-room-${cleanCode}-guest-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

          try {
            this.peer = new window.Peer(guestPeerId, {
              host: config.host || '0.peerjs.com',
              port: config.port || 443,
              path: config.path || '/',
              secure: config.secure !== false,
              config: {
                iceServers: iceServers,
                iceTransportPolicy: iceTransportPolicy,
                iceCandidatePoolSize: 10
              }
            });

            this.peer.on('disconnected', () => {
              if (!this._destroyed && this.peer && !this.peer.destroyed) {
                try { this.peer.reconnect(); } catch (e) {}
              }
            });

            this.peer.on('open', (id) => {
              this._startHeartbeat();
              this.emitState('SIGNALING', { message: 'Signaling connected. Locating room host...' });

              // Connect to host with automatic retry to overcome race conditions
              this._connectWithRetry(hostPeerId, publicKeyJwk, 3, 1200, () => {
                if (!settled) {
                  settled = true;
                  clearTimeout(connectTimeout);
                  this.emit('onReady', { transport: this.transportName, role: 'guest', code: cleanCode });
                  resolve();
                }
              }, (err) => {
                if (!settled) {
                  settled = true;
                  clearTimeout(connectTimeout);
                  const msg = (err && (err.message || err.error)) || 'Could not connect to host.';
                  this.emitState('FAILED', { error: msg });
                  reject(new Error(msg));
                }
              });
            });

            this.peer.on('error', (err) => {
              // Ignore non-fatal peer-unavailable error during retry loop
              if (err.type !== 'peer-unavailable' && !settled) {
                settled = true;
                clearTimeout(connectTimeout);
                this.emitState('FAILED', { error: err.message || 'Error connecting to signaling network.' });
                reject(new Error(err.message || 'Error connecting to signaling network.'));
              }
            });
          } catch (initErr) {
            if (!settled) {
              settled = true;
              clearTimeout(connectTimeout);
              this.emitState('FAILED', { error: initErr.message });
              reject(initErr);
            }
          }
        });
      }
    }

    _connectWithRetry(hostPeerId, publicKeyJwk, maxRetries, delayMs, onOpenSuccess, onFinalError) {
      let attempts = 0;
      let connected = false;

      const attempt = () => {
        if (connected || this._destroyed) return;
        attempts++;

        this.emitState('SIGNALING', {
          message: attempts > 1
            ? `Connecting to room host... (attempt ${attempts}/${maxRetries + 1})`
            : 'Connecting to room host via secure peer network...'
        });

        try {
          if (this.conn) {
            try { this.conn.close(); } catch (e) {}
            this.conn = null;
          }

          const conn = this.peer.connect(hostPeerId, {
            reliable: true,
            serialization: 'json'
          });
          this.conn = conn;

          let attemptTimer = setTimeout(() => {
            if (!connected && attempts <= maxRetries && !this._destroyed) {
              console.log(`[PeerJS] Attempt ${attempts} timed out, retrying in ${delayMs}ms...`);
              setTimeout(attempt, delayMs);
            } else if (!connected && attempts > maxRetries) {
              onFinalError(new Error('Room host not reachable. Please verify the invitation code or confirm creator is online.'));
            }
          }, 12000);

          this._setupConnectionHandlers(conn, publicKeyJwk, () => {
            connected = true;
            clearTimeout(attemptTimer);
            onOpenSuccess();
          }, (err) => {
            clearTimeout(attemptTimer);
            if (!connected && attempts <= maxRetries && !this._destroyed) {
              console.log(`[PeerJS] Connection error on attempt ${attempts}, retrying...`);
              setTimeout(attempt, delayMs);
            } else if (!connected) {
              onFinalError(err);
            }
          });
        } catch (e) {
          if (attempts <= maxRetries && !this._destroyed) {
            setTimeout(attempt, delayMs);
          } else {
            onFinalError(e);
          }
        }
      };

      attempt();
    }

    _setupConnectionHandlers(conn, localPublicKeyJwk, onOpenCallback, onErrorCallback) {
      conn.on('open', () => {
        this.emitState('NEGOTIATING', { message: 'Peer connection established. Verifying participant slot...' });
        this.emit('onConnected');

        if (typeof onOpenCallback === 'function') onOpenCallback();

        if (this.role === 'guest') {
          this.emitState('VERIFYING', { message: 'Initiating cryptographic key exchange...' });
          conn.send({
            type: 'HANDSHAKE_INIT',
            senderId: this.participantId,
            nickname: this.nickname,
            role: this.role,
            jwk: localPublicKeyJwk,
            roomCreatedAt: this.roomCreatedAt,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: 2
          });
        }
      });

      // Hook into RTCPeerConnection to detect ICE candidates, STUN/TURN traversal and ICE state
      try {
        const pc = conn.peerConnection;
        if (pc) {
          pc.onicecandidate = (e) => {
            if (e.candidate) {
              if (e.candidate.type) this.candidateTypes.add(e.candidate.type);
              console.log(`[PeerJS WebRTC Candidate] Type: ${e.candidate.type}, Protocol: ${e.candidate.protocol}, Relay: ${e.candidate.type === 'relay'}`);
            }
          };
          pc.oniceconnectionstatechange = () => {
            console.log(`[PeerJS WebRTC] ICE state: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'checking') {
              this.emitState('NEGOTIATING', { message: 'Negotiating STUN/TURN connection candidates...' });
            } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
              const isRelayed = this.iceTransportPolicy === 'relay' || this.candidateTypes.has('relay');
              this.transportName = isRelayed ? 'WebRTC (TURN Relayed)' : 'PeerJS WebRTC (Cross-Device P2P)';
              this.emitState('VERIFYING', { message: `WebRTC connection secured (${this.transportName}). Exchanging encryption keys...` });
              if (pc.getStats) {
                pc.getStats().then(stats => {
                  stats.forEach(report => {
                    if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.selected)) {
                      console.log(`[WebRTC Stats] Active Pair: Local=${report.localCandidateId}, Remote=${report.remoteCandidateId}`);
                    }
                  });
                }).catch(() => {});
              }
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
              console.warn('[PeerJS WebRTC] ICE connection failed/disconnected');
              if (!this._iceRestartAttempted && pc.restartIce) {
                this._iceRestartAttempted = true;
                try { pc.restartIce(); } catch (e) {}
              }
            }
          };
        }
      } catch (e) {}

      conn.on('data', (data) => {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'ROOM_EXPIRED') {
          this.emit('onRoomExpired', data.message || 'Room expired.');
          this.destroy();
          return;
        }

        if (data.type === 'ROOM_FULL') {
          this.emit('onRoomFull', data.message || 'This room is full.');
          this.destroy();
          return;
        }

        if (data.type === 'HANDSHAKE_INIT') {
          this.emitState('VERIFYING', { message: 'Received guest key. Establishing cryptographic session...' });
          this.emit('onHandshakeReceived', {
            senderId: data.senderId,
            nickname: data.nickname,
            role: data.role,
            jwk: data.jwk,
            roomCreatedAt: data.roomCreatedAt,
            roomType: 'direct',
            maxParticipants: 2,
            participantCount: 2
          });

          if (this.role === 'creator') {
            conn.send({
              type: 'HANDSHAKE_REPLY',
              senderId: this.participantId,
              nickname: this.nickname,
              role: this.role,
              jwk: localPublicKeyJwk,
              roomCreatedAt: this.roomCreatedAt,
              roomType: 'direct',
              maxParticipants: 2,
              participantCount: 2
            });
          }
        } else if (data.type === 'HANDSHAKE_REPLY') {
          this.emitState('VERIFYING', { message: 'Received host key. Finalizing E2EE session...' });
          this.emit('onHandshakeReceived', {
            senderId: data.senderId,
            nickname: data.nickname,
            role: data.role,
            jwk: data.jwk,
            roomCreatedAt: data.roomCreatedAt,
            roomType: 'direct',
            maxParticipants: 2,
            participantCount: 2
          });
        } else if (data.type === 'ENCRYPTED_MESSAGE') {
          this.emit('onEncryptedMessage', data);
        } else if (data.type === 'ENCRYPTED_CHUNK') {
          // Reassemble large messages (e.g. images) sent in 16KB chunks over PeerJS DataChannel
          this._handleIncomingChunk(data, (assembled) => {
            this.emit('onEncryptedMessage', assembled);
          });
        } else if (data.type === 'CLEAR_CHAT') {
          this.emit('onChatCleared', { clearedAt: data.clearedAt, clearedBy: data.clearedBy });
        } else if (data.type === 'REMOVED_BY_CREATOR') {
          this.emit('onRemovedByCreator', data.message || 'You were removed from the room.');
          this.destroy();
        } else if (data.type === 'LEAVE_ROOM') {
          this.emit('onPeerLeft', { nickname: data.nickname, count: 1 });
        }
      });

      conn.on('close', () => {
        this.conn = null;
        this.emit('onDisconnected', 'A participant disconnected.');
      });

      conn.on('error', (err) => {
        if (typeof onErrorCallback === 'function') {
          onErrorCallback(err);
        } else {
          this.emit('onError', err);
        }
      });
    }

    clearChatForBoth() {
      const clearedAt = Date.now();
      if (this.conn && this.conn.open) {
        this.conn.send({
          type: 'CLEAR_CHAT',
          clearedAt: clearedAt,
          clearedBy: this.nickname
        });
      }
      this.emit('onChatCleared', { clearedAt, clearedBy: this.nickname });
    }

    removeGuest() {
      if (this.role === 'creator' && this.conn && this.conn.open) {
        this.conn.send({
          type: 'REMOVED_BY_CREATOR',
          message: 'You have been removed from the room by the creator.'
        });
        setTimeout(() => { if (this.conn) this.conn.close(); }, 200);
      }
    }

    sendEncryptedMessage(payload, senderNickname, timestamp, customSenderId) {
      if (!this.conn || !this.conn.open) {
        throw new Error('WebRTC DataChannel is not open.');
      }

      const senderId = customSenderId || this.participantId || this.role || 'self';
      const msg = {
        type: 'ENCRYPTED_MESSAGE',
        payload: payload,
        senderId: senderId,
        senderNick: senderNickname,
        timestamp: timestamp || Date.now()
      };

      // PeerJS JSON channel throws "Message too big for JSON channel" when conn.send() JSON > 16300 bytes
      // (PeerJS internal util.chunkedMTU = 16300). Using 8192 bytes gives >8KB of headroom for metadata
      // and JSON escaping, preventing any MessageToBig errors on all browsers.
      const serialized = JSON.stringify(msg);
      const CHUNK_SIZE = 8192; // 8KB data per chunk — completely avoids PeerJS 16300-byte limit

      if (serialized.length <= CHUNK_SIZE) {
        this.conn.send(msg);
        return;
      }

      // Large messages (e.g. images): chunk the serialized JSON and send as ENCRYPTED_CHUNK frames
      const chunkId = 'pj-chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        this.conn.send({
          type: 'ENCRYPTED_CHUNK',
          chunkId: chunkId,
          index: i,
          total: totalChunks,
          data: serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          senderId: senderId,
          senderNick: senderNickname,
          timestamp: msg.timestamp
        });
      }
    }

    notifyRoomExpired() {
      try {
        if (this.conn && this.conn.open) {
          this.conn.send({
            type: 'ROOM_EXPIRED',
            message: 'This room has reached its 1-hour expiration and is permanently disabled.'
          });
        }
      } catch (e) {}
    }

    destroy() {
      this._destroyed = true;
      this._stopHeartbeat();
      try {
        if (this.conn && this.conn.open) {
          this.conn.send({ type: 'LEAVE_ROOM', nickname: this.nickname });
          this.conn.close();
        }
        if (this.peer) this.peer.destroy();
      } catch (e) {}
      this.peer = null;
      this.conn = null;
    }
  }

  /**
   * 3. BroadcastChannel Transport (Local Dev / Offline Test Mode)
   */
  class BroadcastChannelTransport extends BaseTransport {
    constructor(callbacks) {
      super(callbacks);
      this.channel = null;
      this.peerPresent = false;
      this.peerId = null;
      this.groupMembers = new Map();
      this.transportName = 'Local Tab Mode (Same Browser / Device)';
    }

    async initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType = 'direct', maxParticipants = 2) {
      this.role = role;
      this.roomId = cleanCode;
      this.nickname = nickname;
      this.participantId = `${role}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      this.publicKeyJwk = publicKeyJwk;
      this.roomCreatedAt = roomCreatedAt || Date.now();
      this.roomType = roomType || 'direct';
      this.maxParticipants = maxParticipants || 2;

      const channelName = `vanishtext_room_${cleanCode}`;
      this.channel = new BroadcastChannel(channelName);

      this.channel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object' || msg.senderId === this.participantId) return;

        if (msg.type === 'PING_JOIN') {
          if (this.role === 'creator') {
            const now = Date.now();
            if (this.roomCreatedAt && (now - this.roomCreatedAt >= 3600000)) {
              this.channel.postMessage({
                type: 'ROOM_EXPIRED',
                targetId: msg.senderId,
                message: 'This room has reached its 1-hour expiration and is permanently disabled.'
              });
              return;
            }

            if (this.roomType === 'group') {
              const maxGuests = (this.maxParticipants || 10) - 1;
              if (this.groupMembers.size >= maxGuests && !this.groupMembers.has(msg.senderId)) {
                this.channel.postMessage({
                  type: 'ROOM_FULL',
                  targetId: msg.senderId,
                  message: `This group room is full.`
                });
                return;
              }
              this.groupMembers.set(msg.senderId, { nickname: msg.nickname });
              this.peerPresent = true;
              this.channel.postMessage({
                type: 'PONG_JOIN',
                targetId: msg.senderId,
                senderId: this.participantId,
                nickname: this.nickname,
                role: this.role,
                jwk: this.publicKeyJwk,
                roomCreatedAt: this.roomCreatedAt,
                roomType: this.roomType,
                maxParticipants: this.maxParticipants,
                participantCount: this.groupMembers.size + 1
              });
              this.emit('onConnected');
              this.emit('onHandshakeReceived', {
                senderId: msg.senderId,
                nickname: msg.nickname,
                role: msg.role,
                jwk: msg.jwk,
                roomCreatedAt: this.roomCreatedAt,
                roomType: this.roomType,
                maxParticipants: this.maxParticipants,
                participantCount: this.groupMembers.size + 1
              });
              return;
            }

            // Strict 1-to-1 Admission Control
            if (this.peerPresent && this.peerId !== msg.senderId) {
              this.channel.postMessage({
                type: 'ROOM_FULL',
                targetId: msg.senderId,
                message: 'This room is full. Only two participants are allowed.'
              });
              return;
            }

            this.peerPresent = true;
            this.peerId = msg.senderId;
            this.channel.postMessage({
              type: 'PONG_JOIN',
              targetId: msg.senderId,
              senderId: this.participantId,
              nickname: this.nickname,
              role: this.role,
              jwk: this.publicKeyJwk,
              roomCreatedAt: this.roomCreatedAt,
              roomType: this.roomType,
              maxParticipants: this.maxParticipants,
              participantCount: 2
            });
            this.emit('onConnected');
            this.emit('onHandshakeReceived', {
              senderId: msg.senderId,
              nickname: msg.nickname,
              role: msg.role,
              jwk: msg.jwk,
              roomCreatedAt: this.roomCreatedAt,
              roomType: this.roomType,
              maxParticipants: this.maxParticipants,
              participantCount: 2
            });
          }
        } else if (msg.type === 'PONG_JOIN') {
          if (msg.targetId === this.participantId) {
            this.peerPresent = true;
            this.peerId = msg.senderId;
            this.emit('onConnected');
            this.emit('onHandshakeReceived', {
              senderId: msg.senderId,
              nickname: msg.nickname,
              role: msg.role,
              jwk: msg.jwk,
              roomCreatedAt: msg.roomCreatedAt,
              roomType: msg.roomType || this.roomType,
              maxParticipants: msg.maxParticipants || this.maxParticipants,
              participantCount: msg.participantCount || 2
            });
          }
        } else if (msg.type === 'ROOM_FULL') {
          if (msg.targetId === this.participantId) {
            this.emit('onRoomFull', msg.message);
            this.destroy();
          }
        } else if (msg.type === 'ENCRYPTED_MESSAGE') {
          this.emit('onEncryptedMessage', msg);
        } else if (msg.type === 'ENCRYPTED_CHUNK') {
          // Reassemble large messages (e.g. images) chunked via BroadcastChannel
          this._handleIncomingChunk(msg, (assembled) => {
            this.emit('onEncryptedMessage', assembled);
          });
        } else if (msg.type === 'CLEAR_CHAT') {
          this.emit('onChatCleared', { clearedAt: msg.clearedAt, clearedBy: msg.clearedBy });
        } else if (msg.type === 'REMOVED_BY_CREATOR') {
          if (!msg.targetId || msg.targetId === this.participantId) {
            this.emit('onRemovedByCreator', msg.message || 'You have been removed from the room by the creator.');
            this.destroy();
          }
        } else if (msg.type === 'LEAVE_ROOM') {
          if (msg.senderId === this.peerId) {
            this.peerPresent = false;
            this.peerId = null;
            this.emit('onPeerLeft', { nickname: msg.nickname, count: 1 });
          }
        } else if (msg.type === 'ROOM_EXPIRED') {
          this.emit('onRoomExpired', msg.message);
          this.destroy();
        }
      };

      this.emit('onReady', { transport: this.transportName, role: this.role, code: cleanCode });

      if (role === 'guest') {
        setTimeout(() => {
          if (this.channel) {
            this.channel.postMessage({
              type: 'PING_JOIN',
              senderId: this.participantId,
              nickname: this.nickname,
              role: this.role,
              jwk: this.publicKeyJwk
            });
          }
        }, 150);
      }
    }

    clearChatForBoth() {
      const clearedAt = Date.now();
      if (this.channel) {
        this.channel.postMessage({
          type: 'CLEAR_CHAT',
          clearedAt: clearedAt,
          clearedBy: this.nickname
        });
      }
      this.emit('onChatCleared', { clearedAt, clearedBy: this.nickname });
    }

    removeGuest() {
      if (this.role === 'creator') {
        if (this.channel) {
          this.channel.postMessage({
            type: 'REMOVED_BY_CREATOR',
            targetId: this.peerId,
            message: 'You have been removed from the room by the creator.'
          });
        }
        this.peerPresent = false;
        this.peerId = null;
      }
    }

    sendEncryptedMessage(payload, senderNickname, timestamp, customSenderId) {
      if (!this.channel) throw new Error('BroadcastChannel is closed.');

      const senderId = customSenderId || this.participantId || this.role || 'self';
      const msg = {
        type: 'ENCRYPTED_MESSAGE',
        payload: payload,
        senderId: senderId,
        senderNick: senderNickname,
        timestamp: timestamp || Date.now()
      };

      // BroadcastChannel supports large structured messages natively,
      // but we chunk anyway to keep consistent with other transports and avoid
      // any browser-specific structured-clone size limits for large base64 images.
      const serialized = JSON.stringify(msg);
      const CHUNK_SIZE = 65536; // 64KB per chunk — BroadcastChannel has no SCTP limits

      if (serialized.length <= CHUNK_SIZE) {
        this.channel.postMessage(msg);
        return;
      }

      const chunkId = 'bc-chk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        this.channel.postMessage({
          type: 'ENCRYPTED_CHUNK',
          chunkId: chunkId,
          index: i,
          total: totalChunks,
          data: serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
          senderId: senderId,
          senderNick: senderNickname,
          timestamp: msg.timestamp
        });
      }
    }

    notifyRoomExpired() {
      try {
        if (this.channel) {
          this.channel.postMessage({
            type: 'ROOM_EXPIRED',
            senderId: this.participantId,
            message: 'This room has reached its 1-hour expiration and is permanently disabled.'
          });
        }
      } catch (e) {}
    }

    destroy() {
      try {
        if (this.channel) {
          this.channel.postMessage({
            type: 'LEAVE_ROOM',
            senderId: this.participantId,
            nickname: this.nickname
          });
          this.channel.close();
        }
      } catch (e) {}
      this.channel = null;
    }
  }

  /**
   * Transport Factory & Manager
   */
  class TransportManager {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.activeTransport = null;
      this.mode = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.transportMode) || 'auto';
    }

    async connect(role, cleanCode, nickname, publicKeyJwk, preferredMode, roomCreatedAt, roomType = 'direct', maxParticipants = 2) {
      const mode = preferredMode || this.mode;

      if (mode === 'broadcast') {
        this.activeTransport = new BroadcastChannelTransport(this.callbacks);
        await this.activeTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
        return this.activeTransport;
      }

      if (mode === 'peerjs') {
        this.activeTransport = new PeerJsTransport(this.callbacks);
        await this.activeTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
        return this.activeTransport;
      }

      // 'auto' mode:
      // 1. Check if hosted on a static serverless deployment (e.g. Vercel, Netlify, GitHub Pages) without an external WebSocket signaling URL configured
      const isStaticDeploy = (typeof window !== 'undefined' && window.location && window.location.host)
        ? (window.location.host.endsWith('.vercel.app') ||
           window.location.host.endsWith('.netlify.app') ||
           window.location.host.endsWith('.github.io') ||
           window.location.host.endsWith('.pages.dev')) &&
           !(window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.signaling && window.CHATSPACE_CONFIG.signaling.serverUrl)
        : false;

      if (isStaticDeploy && typeof window.Peer !== 'undefined') {
        console.log('[TransportManager] Static deployment detected. Using PeerJS WebRTC transport directly...');
        this.activeTransport = new PeerJsTransport(this.callbacks);
        await this.activeTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
        return this.activeTransport;
      }

      // 2. Try ServerSignalingTransport first
      let serverTransport = null;
      try {
        serverTransport = new ServerSignalingTransport(this.callbacks);
        await serverTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
        this.activeTransport = serverTransport;
        return this.activeTransport;
      } catch (serverErr) {
        if (serverTransport) {
          try { serverTransport.destroy(); } catch (e) {}
        }
        console.warn('[TransportManager] ServerSignalingTransport unavailable or failed:', serverErr.message);

        // Tier 2: PeerJS WebRTC (if explicitly available/configured)
        if (typeof window.Peer !== 'undefined') {
          console.log('[TransportManager] Trying PeerJS transport...');
          const peerTransport = new PeerJsTransport(this.callbacks);
          await peerTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
          this.activeTransport = peerTransport;
          return this.activeTransport;
        }

        // Tier 3: Local/offline browser tab fallback (BroadcastChannel)
        console.log('[TransportManager] Using BroadcastChannel transport for local browser fallback...');
        this.activeTransport = new BroadcastChannelTransport(this.callbacks);
        await this.activeTransport.initRoom(role, cleanCode, nickname, publicKeyJwk, roomCreatedAt, roomType, maxParticipants);
        return this.activeTransport;
      }
    }

    admitGuest(guestId) {
      if (this.activeTransport && typeof this.activeTransport.admitGuest === 'function') {
        this.activeTransport.admitGuest(guestId);
      }
    }

    rejectGuest(guestId) {
      if (this.activeTransport && typeof this.activeTransport.rejectGuest === 'function') {
        this.activeTransport.rejectGuest(guestId);
      }
    }

    removeGuest(guestId) {
      if (this.activeTransport && typeof this.activeTransport.removeGuest === 'function') {
        this.activeTransport.removeGuest(guestId);
      }
    }

    clearChatForBoth() {
      if (this.activeTransport && typeof this.activeTransport.clearChatForBoth === 'function') {
        this.activeTransport.clearChatForBoth();
      }
    }

    notifyRoomExpired() {
      if (this.activeTransport && typeof this.activeTransport.notifyRoomExpired === 'function') {
        this.activeTransport.notifyRoomExpired();
      }
    }

    emitState(state, details = {}) {
      if (this.activeTransport && typeof this.activeTransport.emitState === 'function') {
        this.activeTransport.emitState(state, details);
      } else if (this.callbacks) {
        if (typeof this.callbacks.onStateChange === 'function') {
          try { this.callbacks.onStateChange(state, details); } catch (e) {}
        }
        const eventName = 'on' + state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
        if (typeof this.callbacks[eventName] === 'function') {
          try { this.callbacks[eventName](details); } catch (e) {}
        }
      }
    }

    getParticipantId() {
      return this.activeTransport && typeof this.activeTransport.getParticipantId === 'function'
        ? this.activeTransport.getParticipantId()
        : (this.activeTransport ? (this.activeTransport.participantId || this.activeTransport.role) : null);
    }

    sendEncryptedMessage(payload, nickname, timestamp, senderId) {
      if (!this.activeTransport) {
        throw new Error('No active transport available.');
      }
      this.activeTransport.sendEncryptedMessage(payload, nickname, timestamp, senderId);
    }

    getTransportName() {
      return this.activeTransport ? this.activeTransport.transportName : 'None';
    }

    destroy() {
      if (this.activeTransport) {
        this.activeTransport.destroy();
        this.activeTransport = null;
      }
    }
  }

  window.VanishTransportManager = TransportManager;
  window.ServerSignalingTransport = ServerSignalingTransport;
  window.PeerJsTransport = PeerJsTransport;
  window.BroadcastChannelTransport = BroadcastChannelTransport;
})(window);
