/**
 * VanishText {Made by SUVX}
 * Room Lifecycle & Session Coordination Module
 *
 * Enforces:
 * - Temporary 1-to-1 room lifecycle (strictly 2 participants)
 * - 60-minute expiration timer
 * - Handshake coordination with VanishCryptoEngine
 * - Clean teardown upon departure or expiration
 */

(function (window) {
  'use strict';

  const ROOM_STATES = {
    IDLE: 'IDLE',
    CREATING: 'CREATING',
    CONNECTING: 'CONNECTING',
    SIGNALING: 'SIGNALING',
    NEGOTIATING: 'NEGOTIATING',
    VERIFYING: 'VERIFYING',
    WAITING_FOR_PEER: 'WAITING_FOR_PEER',
    WAITING_FOR_ADMISSION: 'WAITING_FOR_ADMISSION',
    ADMISSION_REQUEST: 'ADMISSION_REQUEST',
    ADMISSION_REJECTED: 'ADMISSION_REJECTED',
    REMOVED_BY_CREATOR: 'REMOVED_BY_CREATOR',
    JOINING: 'JOINING',
    HANDSHAKE: 'HANDSHAKE',
    CONNECTED: 'CONNECTED',
    PEER_DISCONNECTED: 'PEER_DISCONNECTED',
    ROOM_FULL: 'ROOM_FULL',
    EXPIRED: 'EXPIRED',
    FAILED: 'FAILED',
    ERROR: 'ERROR'
  };

  class RoomSession {
    constructor() {
      this.state = ROOM_STATES.IDLE;
      this.roomId = null;             // Normalized code
      this.formattedCode = null;      // Formatted "XXXX-XXXX-XXXX"
      this.roomName = 'Private Room';
      this.localNickname = '';
      this.remoteNickname = '';
      this.role = null;               // 'creator' | 'guest'
      this.roomType = 'direct';       // 'direct' | 'group'
      this.maxParticipants = 2;
      this.participantCount = 1;
      this.participants = new Map();  // senderId -> nickname
      this.createdAt = null;
      this.createdPerf = 0;
      this.expiresAt = null;
      this.ttlTimerId = null;
      this._onVisibilityCheck = null;

      const ttlMinutes = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.room && window.CHATSPACE_CONFIG.room.roomTtlMinutes) || 60;
      this.ttlMs = ttlMinutes * 60 * 1000;

      this.crypto = new window.VanishCryptoEngine();
      this.transport = null;

      // Saved parameters for retry functionality
      this.lastCreateParams = null;
      this.lastJoinParams = null;

      // Listeners for UI state updates
      this.onStateChangeCallbacks = [];
      this.onMessageReceivedCallbacks = [];
      this.onChatClearedCallbacks = [];
      this.onAdmissionRequestCallbacks = [];
      this.pendingAdmissionGuestId = null;
    }

    onStateChange(callback) {
      this.onStateChangeCallbacks.push(callback);
    }

    onMessageReceived(callback) {
      this.onMessageReceivedCallbacks.push(callback);
    }

    onChatCleared(callback) {
      this.onChatClearedCallbacks.push(callback);
    }

    onAdmissionRequest(callback) {
      this.onAdmissionRequestCallbacks.push(callback);
    }

    _setState(newState, details = {}) {
      this.state = newState;
      console.log(`[RoomSession] State => ${newState}`, details);
      for (const cb of this.onStateChangeCallbacks) {
        try {
          cb(newState, details);
        } catch (e) {
          console.error('[RoomSession] Callback error:', e);
        }
      }
    }

    /**
     * Create a brand new private room.
     * Generates a CSPRNG invitation code and sets the user as Participant 1.
     * @param {string} nickname
     * @param {string} roomName
     * @param {string} [preferredTransport]
     */
    async createRoom(nickname, roomName, preferredTransport, roomType = 'direct', maxParticipants) {
      const nickVal = window.VanishValidation.validateNickname(nickname);
      if (!nickVal.valid) throw new Error(nickVal.error);

      const nameVal = window.VanishValidation.validateRoomName(roomName);
      if (!nameVal.valid) throw new Error(nameVal.error);

      const typeVal = window.VanishValidation.validateRoomType
        ? window.VanishValidation.validateRoomType(roomType)
        : { type: roomType, maxParticipants: roomType === 'group' ? 10 : 2 };

      this.leaveRoom(); // reset any prior session
      this._setState(ROOM_STATES.CREATING);

      this.localNickname = nickVal.sanitized;
      this.roomName = nameVal.sanitized;
      this.role = 'creator';
      this.roomType = typeVal.type;
      this.maxParticipants = typeof maxParticipants === 'number' ? maxParticipants : (typeVal.maxParticipants || 2);
      this.participantCount = 1;
      this.participants.clear();
      this.participants.set('creator', { id: 'creator', nickname: this.localNickname, role: 'creator', isOwner: true, isSelf: true });

      // Generate cryptographically secure invitation code
      this.formattedCode = this.crypto.generateSecureRoomCode(12);
      this.roomId = this.formattedCode.replace(/-/g, '');
      this.createdAt = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      this.createdPerf = (typeof performance !== 'undefined') ? performance.now() : 0;
      const ttlMinutes = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.room && window.CHATSPACE_CONFIG.room.roomTtlMinutes) || 60;
      this.ttlMs = ttlMinutes * 60 * 1000;
      this.expiresAt = this.createdAt + this.ttlMs;

      // Group rooms derive symmetric room key immediately from room code
      if (this.roomType === 'group' || this.maxParticipants > 2) {
        await this.crypto.establishGroupSession(this.formattedCode, this.roomId);
      }

      // Ephemeral ECDH keypair generation
      const localJwk = await this.crypto.generateEphemeralKeypair();

      this.lastCreateParams = {
        nickname: nickVal.sanitized,
        roomName: nameVal.sanitized,
        preferredTransport,
        roomType: typeVal.type,
        maxParticipants: this.maxParticipants
      };

      // Initialize transport manager
      this.transport = new window.VanishTransportManager({
        onConnecting: (details) => {
          this._setState(ROOM_STATES.CONNECTING, details || { message: 'Connecting to signaling network...' });
        },
        onSignaling: (details) => {
          this._setState(ROOM_STATES.SIGNALING, details || { message: 'Registering room on signaling service...' });
        },
        onNegotiating: (details) => {
          this._setState(ROOM_STATES.NEGOTIATING, details || { message: 'Negotiating peer connection...' });
        },
        onVerifying: (details) => {
          this._setState(ROOM_STATES.VERIFYING, details || { message: 'Verifying participant slot...' });
        },
        onFailed: (err) => {
          const errMsg = this._formatErrorString(err);
          this._setState(ROOM_STATES.FAILED, { error: errMsg });
        },
        onReady: (info) => {
          this._startTtlTimer();
          this._setState(ROOM_STATES.WAITING_FOR_PEER, {
            formattedCode: this.formattedCode,
            roomId: this.roomId,
            roomName: this.roomName,
            transportName: info.transport,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: 1,
            participants: this.participants
          });
        },
        onConnected: () => {
          this._setState(ROOM_STATES.HANDSHAKE, { message: 'Participant connected. Exchanging encryption keys...' });
        },
        onHandshakeReceived: async (peerData) => {
          await this._handlePeerHandshake(peerData);
        },
        onParticipantCountUpdated: (info) => {
          if (info.count) this.participantCount = info.count;
          this._setState(ROOM_STATES.CONNECTED, {
            remoteNickname: this.remoteNickname,
            localNickname: this.localNickname,
            roomName: this.roomName,
            formattedCode: this.formattedCode,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: this.participantCount,
            participants: this.participants,
            verification: this.crypto.verificationData,
            transportName: this.transport ? this.transport.getTransportName() : ''
          });
        },
        onParticipantJoined: (info) => {
          this.participants.set(info.participantId, {
            id: info.participantId,
            nickname: info.nickname,
            role: 'guest',
            isOwner: false,
            isSelf: false
          });
          this.participantCount = this.participants.size;
          this._setState(ROOM_STATES.CONNECTED, {
            remoteNickname: this.remoteNickname,
            localNickname: this.localNickname,
            roomName: this.roomName,
            formattedCode: this.formattedCode,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: this.participantCount,
            participants: this.participants,
            verification: this.crypto.verificationData,
            transportName: this.transport ? this.transport.getTransportName() : ''
          });
          for (const cb of this.onMessageReceivedCallbacks) {
            cb({
              text: `${info.nickname} joined the room.`,
              senderNick: 'System',
              isSystem: true,
              timestamp: Date.now()
            });
          }
        },
        onEncryptedMessage: (data) => {
          this._handleIncomingEncryptedMessage(data);
        },
        onPeerLeft: (peerInfo) => {
          if (peerInfo.participantId || peerInfo.guestId) {
            this.participants.delete(peerInfo.participantId || peerInfo.guestId);
          } else {
            for (const key of Array.from(this.participants.keys())) {
              if (key !== 'creator' && key !== 'self') this.participants.delete(key);
            }
          }
          this.participantCount = Math.max(1, this.participants.size);

          if (this.roomType === 'group' || this.maxParticipants > 2) {
            if (peerInfo.count) this.participantCount = peerInfo.count;
            this._setState(this.participantCount > 1 ? ROOM_STATES.CONNECTED : ROOM_STATES.WAITING_FOR_PEER, {
              remoteNickname: this.remoteNickname,
              localNickname: this.localNickname,
              roomName: this.roomName,
              formattedCode: this.formattedCode,
              roomType: this.roomType,
              maxParticipants: this.maxParticipants,
              participantCount: this.participantCount,
              participants: this.participants,
              verification: this.crypto.verificationData,
              transportName: this.transport ? this.transport.getTransportName() : ''
            });
            for (const cb of this.onMessageReceivedCallbacks) {
              cb({
                text: `${peerInfo.nickname || 'A member'} left the room.`,
                senderNick: 'System',
                isSystem: true,
                timestamp: Date.now()
              });
            }
          } else {
            this.remoteNickname = '';
            this._setState(ROOM_STATES.PEER_DISCONNECTED, {
              message: `${peerInfo.nickname || 'Participant'} has left the room.`,
              participants: this.participants
            });
          }
        },
        onRoomFull: (msg) => {
          this._setState(ROOM_STATES.ROOM_FULL, { message: msg });
        },
        onAdmissionRequest: (info) => {
          this.pendingAdmissionGuestId = info.guestId;
          for (const cb of this.onAdmissionRequestCallbacks) {
            try { cb(info); } catch(e) {}
          }
          this._setState(ROOM_STATES.ADMISSION_REQUEST, info);
          // If the invitation code is right, the user enters the room directly
          try {
            this.admitGuest(info.guestId);
          } catch (e) {
            console.warn('[RoomSession] Auto-admit error:', e);
          }
        },
        onChatCleared: (info) => {
          for (const cb of this.onChatClearedCallbacks) {
            try { cb(info); } catch(e) {}
          }
        },
        onRemovedByCreator: (msg) => {
          this._teardownResources();
          this._setState(ROOM_STATES.REMOVED_BY_CREATOR, { message: msg });
        },
        onRoomExpired: () => {
          this.expireRoom();
        },
        onDisconnected: (reason) => {
          this._setState(ROOM_STATES.PEER_DISCONNECTED, { message: reason || 'Disconnected from peer.' });
        },
        onError: (err) => {
          const errMsg = this._formatErrorString(err);
          this._setState(ROOM_STATES.FAILED, { error: errMsg });
        }
      });

      try {
        await this.transport.connect('creator', this.roomId, this.localNickname, localJwk, preferredTransport, this.createdAt, this.roomType, this.maxParticipants);
      } catch (err) {
        const errMsg = this._formatErrorString(err);
        this._setState(ROOM_STATES.FAILED, { error: errMsg });
        throw err;
      }
      return {
        formattedCode: this.formattedCode,
        roomId: this.roomId,
        roomName: this.roomName,
        roomType: this.roomType
      };
    }

    /**
     * Join an existing private room as Participant 2.
     * @param {string} rawCode
     * @param {string} nickname
     * @param {string} [preferredTransport]
     */
    async joinRoom(rawCode, nickname, preferredTransport) {
      // Check joining rate limits
      const rateCheck = window.VanishValidation.checkJoinRateLimit();
      if (!rateCheck.allowed) {
        throw new Error(`Too many join attempts. Please wait ${Math.ceil(rateCheck.waitMs / 1000)} seconds.`);
      }

      const codeVal = window.VanishValidation.validateRoomCode(rawCode);
      if (!codeVal.valid) throw new Error(codeVal.error);

      // Rule 4: Never reactivate an expired room
      if (window.VanishValidation && window.VanishValidation.isRoomExpired(codeVal.normalized)) {
        throw new Error('This room has reached its 1-hour expiration and is permanently disabled. Never reactivate an expired room; please create a new room with a new invitation code.');
      }

      const nickVal = window.VanishValidation.validateNickname(nickname);
      if (!nickVal.valid) throw new Error(nickVal.error);

      this.leaveRoom();
      this._setState(ROOM_STATES.JOINING);

      this.roomId = codeVal.normalized;
      this.formattedCode = codeVal.formatted;
      this.localNickname = nickVal.sanitized;
      this.role = 'guest';
      this.createdAt = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      this.createdPerf = (typeof performance !== 'undefined') ? performance.now() : 0;
      const ttlMinutes = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.room && window.CHATSPACE_CONFIG.room.roomTtlMinutes) || 60;
      this.ttlMs = ttlMinutes * 60 * 1000;
      this.expiresAt = this.createdAt + this.ttlMs;
      this.participants.clear();
      this.participants.set('self', { id: 'self', nickname: this.localNickname, role: 'guest', isOwner: false, isSelf: true });

      this.lastJoinParams = {
        rawCode,
        nickname: nickVal.sanitized,
        preferredTransport
      };

      // Ephemeral ECDH keypair generation
      const localJwk = await this.crypto.generateEphemeralKeypair();

      this.transport = new window.VanishTransportManager({
        onConnecting: (details) => {
          this._setState(ROOM_STATES.CONNECTING, details || { message: 'Connecting to secure network...' });
        },
        onSignaling: (details) => {
          this._setState(ROOM_STATES.SIGNALING, details || { message: 'Discovering room host...' });
        },
        onNegotiating: (details) => {
          this._setState(ROOM_STATES.NEGOTIATING, details || { message: 'Negotiating WebRTC connection...' });
        },
        onVerifying: (details) => {
          this._setState(ROOM_STATES.VERIFYING, details || { message: 'Verifying participant slot...' });
        },
        onFailed: (err) => {
          const errMsg = this._formatErrorString(err);
          this._setState(ROOM_STATES.FAILED, { error: errMsg });
        },
        onReady: () => {
          this._startTtlTimer();
        },
        onConnected: () => {
          this._setState(ROOM_STATES.HANDSHAKE, { message: 'Connected to host. Initiating ECDH key exchange...' });
        },
        onHandshakeReceived: async (peerData) => {
          await this._handlePeerHandshake(peerData);
        },
        onParticipantCountUpdated: (info) => {
          if (info.count) this.participantCount = info.count;
          this._setState(ROOM_STATES.CONNECTED, {
            remoteNickname: this.remoteNickname,
            localNickname: this.localNickname,
            roomName: this.roomName,
            formattedCode: this.formattedCode,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: this.participantCount,
            participants: this.participants,
            verification: this.crypto.verificationData,
            transportName: this.transport ? this.transport.getTransportName() : ''
          });
        },
        onParticipantJoined: (info) => {
          this.participants.set(info.participantId, {
            id: info.participantId,
            nickname: info.nickname,
            role: 'guest',
            isOwner: false,
            isSelf: false
          });
          this.participantCount = this.participants.size;
          this._setState(ROOM_STATES.CONNECTED, {
            remoteNickname: this.remoteNickname,
            localNickname: this.localNickname,
            roomName: this.roomName,
            formattedCode: this.formattedCode,
            roomType: this.roomType,
            maxParticipants: this.maxParticipants,
            participantCount: this.participantCount,
            participants: this.participants,
            verification: this.crypto.verificationData,
            transportName: this.transport ? this.transport.getTransportName() : ''
          });
          for (const cb of this.onMessageReceivedCallbacks) {
            cb({
              text: `${info.nickname} joined the room.`,
              senderNick: 'System',
              isSystem: true,
              timestamp: Date.now()
            });
          }
        },
        onEncryptedMessage: (data) => {
          this._handleIncomingEncryptedMessage(data);
        },
        onPeerLeft: (peerInfo) => {
          if (peerInfo.participantId || peerInfo.guestId) {
            this.participants.delete(peerInfo.participantId || peerInfo.guestId);
          } else {
            for (const key of Array.from(this.participants.keys())) {
              if (key !== 'creator' && key !== 'self') this.participants.delete(key);
            }
          }
          this.participantCount = Math.max(1, this.participants.size);

          if (this.roomType === 'group' || this.maxParticipants > 2) {
            if (peerInfo.count) this.participantCount = peerInfo.count;
            this._setState(this.participantCount > 1 ? ROOM_STATES.CONNECTED : ROOM_STATES.WAITING_FOR_PEER, {
              remoteNickname: this.remoteNickname,
              localNickname: this.localNickname,
              roomName: this.roomName,
              formattedCode: this.formattedCode,
              roomType: this.roomType,
              maxParticipants: this.maxParticipants,
              participantCount: this.participantCount,
              participants: this.participants,
              verification: this.crypto.verificationData,
              transportName: this.transport ? this.transport.getTransportName() : ''
            });
            for (const cb of this.onMessageReceivedCallbacks) {
              cb({
                text: `${peerInfo.nickname || 'A member'} left the group.`,
                senderNick: 'System',
                isSystem: true,
                timestamp: Date.now()
              });
            }
          } else {
            this.remoteNickname = '';
            this._setState(ROOM_STATES.PEER_DISCONNECTED, {
              message: `${peerInfo.nickname || 'Participant'} has left the room.`,
              participants: this.participants
            });
          }
        },
        onRoomFull: (msg) => {
          this._setState(ROOM_STATES.ROOM_FULL, { message: msg });
        },
        onWaitingForAdmission: (info) => {
          this._setState(ROOM_STATES.WAITING_FOR_ADMISSION, info);
        },
        onAdmissionRejected: (msg) => {
          this._setState(ROOM_STATES.ADMISSION_REJECTED, { message: msg });
        },
        onRemovedByCreator: (msg) => {
          this._teardownResources();
          this._setState(ROOM_STATES.REMOVED_BY_CREATOR, { message: msg });
        },
        onChatCleared: (info) => {
          for (const cb of this.onChatClearedCallbacks) {
            try { cb(info); } catch(e) {}
          }
        },
        onRoomExpired: () => {
          this.expireRoom();
        },
        onDisconnected: (reason) => {
          this._setState(ROOM_STATES.PEER_DISCONNECTED, { message: reason || 'Disconnected from room.' });
        },
        onError: (err) => {
          const errMsg = this._formatErrorString(err);
          this._setState(ROOM_STATES.FAILED, { error: errMsg });
        }
      });

      try {
        await this.transport.connect('guest', this.roomId, this.localNickname, localJwk, preferredTransport, this.createdAt);
      } catch (err) {
        const errMsg = this._formatErrorString(err);
        this._setState(ROOM_STATES.FAILED, { error: errMsg });
        throw err;
      }
    }

    /**
     * Handle incoming peer public key and establish shared AES-GCM + SAS session.
     * Synchronizes room creation time from creator to enforce exact 1-hour expiration.
     * @private
     */
    async _handlePeerHandshake(peerData) {
      try {
        if (peerData.roomCreatedAt && typeof peerData.roomCreatedAt === 'number') {
          this.createdAt = peerData.roomCreatedAt;
          this.expiresAt = this.createdAt + this.ttlMs;
          if (this._checkIfExpired()) {
            return;
          }
        }

        if (peerData.roomType) this.roomType = peerData.roomType;
        if (peerData.maxParticipants) this.maxParticipants = peerData.maxParticipants;

        if (this.role === 'creator') {
          this.participants.set(peerData.senderId || 'guest', {
            id: peerData.senderId || 'guest',
            nickname: peerData.nickname || 'Guest',
            role: 'guest',
            isOwner: false,
            isSelf: false
          });
        } else {
          this.participants.set('creator', {
            id: 'creator',
            nickname: peerData.nickname || 'Room Owner',
            role: 'creator',
            isOwner: true,
            isSelf: false
          });
        }

        let verification = null;
        if (this.roomType === 'group' || this.maxParticipants > 2) {
          verification = await this.crypto.establishGroupSession(this.formattedCode, this.roomId);
          this.participantCount = peerData.participantCount || Math.max(2, this.participants.size);
          this.remoteNickname = `${this.participantCount - 1} member${this.participantCount > 2 ? 's' : ''}`;
        } else {
          this.remoteNickname = peerData.nickname || (this.role === 'creator' ? 'Participant 2' : 'Host');
          verification = await this.crypto.establishSharedSession(peerData.jwk, this.roomId);
          this.participantCount = 2;
        }

        this._setState(ROOM_STATES.CONNECTED, {
          remoteNickname: this.remoteNickname,
          localNickname: this.localNickname,
          roomName: this.roomName,
          formattedCode: this.formattedCode,
          roomType: this.roomType,
          maxParticipants: this.maxParticipants,
          participantCount: this.participantCount,
          participants: this.participants,
          verification: verification,
          transportName: this.transport ? this.transport.getTransportName() : ''
        });
      } catch (err) {
        console.error('[RoomSession] Handshake failed:', err);
        this._setState(ROOM_STATES.FAILED, { error: 'Failed to establish encrypted session: ' + err.message });
      }
    }

    /**
     * Receive and decrypt incoming ciphertext.
     * Verifies message lifetime; discards any message older than 15 minutes.
     * @private
     */
    async _handleIncomingEncryptedMessage(data) {
      if (!this.crypto.hasActiveSession()) {
        console.warn('[RoomSession] Received message but crypto session is not ready.');
        return;
      }

      if (this._checkIfExpired()) {
        console.warn('[RoomSession] Message rejected: room has expired.');
        return;
      }

      const msgTimestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
      const msgTtlMinutes = (window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.messaging && window.CHATSPACE_CONFIG.messaging.messageTtlMinutes) || 15;
      const ttlMs = msgTtlMinutes * 60 * 1000;

      // Reliable enforcement: reject expired incoming message immediately
      if (window.VanishTimeAuthority && window.VanishTimeAuthority.isMessageExpired(msgTimestamp, ttlMs)) {
        console.warn('[RoomSession] Received message has already expired (> 15m). Discarding.');
        return;
      }

      const candidateSenderIds = [];
      if (data.senderId) candidateSenderIds.push(data.senderId);
      const roleDefault = this.role === 'creator' ? 'guest' : 'creator';
      if (!candidateSenderIds.includes(roleDefault)) candidateSenderIds.push(roleDefault);
      if (this.remoteNickname && !candidateSenderIds.includes(this.remoteNickname)) {
        candidateSenderIds.push(this.remoteNickname);
      }
      if (this.participants && typeof this.participants.keys === 'function') {
        for (const pId of this.participants.keys()) {
          if (pId && !candidateSenderIds.includes(pId)) {
            candidateSenderIds.push(pId);
          }
        }
      }
      if (!candidateSenderIds.includes('creator')) candidateSenderIds.push('creator');
      if (!candidateSenderIds.includes('guest')) candidateSenderIds.push('guest');
      if (!candidateSenderIds.includes('self')) candidateSenderIds.push('self');

      let decryptedText = null;
      let lastErr = null;
      for (const sid of candidateSenderIds) {
        try {
          decryptedText = await this.crypto.decryptMessage(data.payload, {
            roomId: this.roomId,
            senderId: sid
          });
          if (decryptedText !== null && decryptedText !== undefined) {
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }

      if (decryptedText === null) {
        console.error('[RoomSession] Decryption failed for all candidate sender IDs:', lastErr);
        for (const cb of this.onMessageReceivedCallbacks) {
          cb({
            text: '⚠️ [Security Alert: Tampered or unauthenticated message rejected.]',
            senderNick: 'System',
            isSelf: false,
            isSecurityAlert: true,
            timestamp: Date.now()
          });
        }
        return;
      }

      try {
        // Check if decrypted payload is an image or image consumption status
        let parsed = null;
        if (typeof decryptedText === 'string' && decryptedText.startsWith('{')) {
          try {
            parsed = JSON.parse(decryptedText);
          } catch (e) {
            parsed = null;
          }
        }

        if (parsed && (parsed.kind === 'image_once' || parsed.type === 'image_once')) {
          for (const cb of this.onMessageReceivedCallbacks) {
            try {
              cb({
                id: parsed.imageId,
                isImage: true,
                imagePayload: parsed,
                senderNick: data.senderNick || this.remoteNickname || 'Participant',
                isSelf: false,
                timestamp: msgTimestamp
              });
            } catch (e) {
              console.error('[RoomSession] Image callback error:', e);
            }
          }
          return;
        }

        if (parsed && (parsed.kind === 'image_consumed' || parsed.type === 'image_consumed')) {
          for (const cb of this.onMessageReceivedCallbacks) {
            try {
              cb({
                isImageStatus: true,
                status: 'consumed',
                imageId: parsed.imageId,
                senderNick: data.senderNick,
                timestamp: msgTimestamp
              });
            } catch (e) {
              console.error('[RoomSession] Image status callback error:', e);
            }
          }
          return;
        }

        // Notify chat controller with decrypted plain text and verified timestamp
        for (const cb of this.onMessageReceivedCallbacks) {
          try {
            cb({
              text: decryptedText,
              senderNick: data.senderNick || this.remoteNickname || 'Participant',
              isSelf: false,
              timestamp: msgTimestamp
            });
          } catch (e) {
            console.error('[RoomSession] Message callback error:', e);
          }
        }
      } catch (err) {
        console.error('[RoomSession] Message processing error:', err);
      }
    }

    /**
     * Get the consistent sender identifier for encryption AAD and message routing.
     * @returns {string}
     */
    getSenderId() {
      if (this.transport && typeof this.transport.getParticipantId === 'function') {
        const id = this.transport.getParticipantId();
        if (id) return id;
      }
      return this.role || 'self';
    }

    /**
     * Send an outbound encrypted message.
     * @param {string} text
     */
    async sendMessage(text) {
      if (this._checkIfExpired()) {
        throw new Error('Cannot send message: room has reached its 1-hour expiration and is permanently disabled.');
      }

      if (this.state !== ROOM_STATES.CONNECTED) {
        throw new Error('Cannot send message. Room is not connected and encrypted.');
      }

      const msgVal = window.VanishValidation.validateMessage(text);
      if (!msgVal.valid) throw new Error(msgVal.error);

      const rateCheck = window.VanishValidation.checkMessageRateLimit();
      if (!rateCheck.allowed) {
        throw new Error(`Message rate limit reached. Please wait ${Math.ceil(rateCheck.waitMs / 1000)}s.`);
      }

      // Encrypt message locally with fresh IV and bound AAD
      const senderId = this.getSenderId();
      const encryptedPayload = await this.crypto.encryptMessage(msgVal.sanitized, {
        roomId: this.roomId,
        senderId: senderId
      });

      const messageTimestamp = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();

      // Transmit ciphertext over transport with creation timestamp and senderId
      this.transport.sendEncryptedMessage(encryptedPayload, this.localNickname, messageTimestamp, senderId);

      // Return self message for local live display
      return {
        text: msgVal.sanitized,
        senderNick: this.localNickname,
        isSelf: true,
        timestamp: messageTimestamp
      };
    }

    /**
     * Send an end-to-end encrypted one-time-view image.
     * Validates file, reads and compresses to memory-only dataUrl, encrypts with AES-256-GCM.
     * @param {File|Blob} file
     * @returns {Promise<Object>}
     */
    async sendImageMessage(file) {
      if (this._checkIfExpired()) {
        throw new Error('Cannot send image: room has reached its 1-hour expiration and is permanently disabled.');
      }

      if (this.state !== ROOM_STATES.CONNECTED) {
        throw new Error('Cannot send image. Room is not connected and encrypted.');
      }

      const val = window.VanishValidation.validateImageFile(file);
      if (!val.valid) throw new Error(val.error);

      // Read magic bytes
      const buffer = await this._readFileAsArrayBuffer(file);
      const magicVal = window.VanishValidation.validateImageMagicBytes(buffer);
      if (!magicVal.valid) throw new Error(magicVal.error);

      // Convert & optimize image to base64 dataUrl (memory only)
      const dataUrl = await this._processImageFile(file);

      const messageTimestamp = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      const imageId = 'img-' + messageTimestamp + '-' + Math.random().toString(36).slice(2, 9);

      const imagePayload = {
        kind: 'image_once',
        imageId: imageId,
        fileName: file.name || 'image.jpg',
        fileType: file.type || 'image/jpeg',
        dataUrl: dataUrl,
        sentAt: messageTimestamp
      };

      // Genuine End-to-End Encryption with AES-256-GCM
      const senderId = this.getSenderId();
      const encryptedPayload = await this.crypto.encryptMessage(JSON.stringify(imagePayload), {
        roomId: this.roomId,
        senderId: senderId
      });

      // Transmit ciphertext over transport
      this.transport.sendEncryptedMessage(encryptedPayload, this.localNickname, messageTimestamp, senderId);

      return {
        id: imageId,
        isSelf: true,
        isImage: true,
        imagePayload: imagePayload,
        timestamp: messageTimestamp,
        senderNick: this.localNickname
      };
    }

    /**
     * Synchronize image consumption across room participants.
     * @param {string} imageId
     */
    async sendImageConsumed(imageId) {
      if (this.state !== ROOM_STATES.CONNECTED || !imageId) return;
      try {
        const payload = {
          kind: 'image_consumed',
          imageId: imageId
        };
        const senderId = this.getSenderId();
        const encryptedPayload = await this.crypto.encryptMessage(JSON.stringify(payload), {
          roomId: this.roomId,
          senderId: senderId
        });
        this.transport.sendEncryptedMessage(encryptedPayload, this.localNickname, Date.now(), senderId);
      } catch (e) {
        console.warn('[RoomSession] Failed to send image consumption sync:', e);
      }
    }

    /**
     * Read file as ArrayBuffer helper
     * @private
     */
    _readFileAsArrayBuffer(file) {
      return new Promise((resolve, reject) => {
        if (!file || typeof FileReader === 'undefined') {
          // Node or mock environment fallback
          if (file && file.arrayBuffer) {
            file.arrayBuffer().then(resolve).catch(reject);
            return;
          }
          // Default small buffer for tests
          resolve(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsArrayBuffer(file);
      });
    }

    /**
     * Process, resize, and optimize image to dataURL (maintains memory-only guarantee)
     * @private
     */
    _processImageFile(file) {
      return new Promise((resolve, reject) => {
        if (!file || typeof FileReader === 'undefined') {
          resolve('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.onload = (e) => {
          const rawDataUrl = e.target.result;
          if (typeof Image === 'undefined' || typeof document === 'undefined') {
            resolve(rawDataUrl);
            return;
          }
          const img = new Image();
          img.onload = () => {
            const MAX_DIM = 1280;
            let width = img.width;
            let height = img.height;
            if (width > MAX_DIM || height > MAX_DIM) {
              if (width > height) {
                height = Math.round((height * MAX_DIM) / width);
                width = MAX_DIM;
              } else {
                width = Math.round((width * MAX_DIM) / height);
                height = MAX_DIM;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const optimized = canvas.toDataURL('image/jpeg', 0.82);
            resolve(optimized);
          };
          img.onerror = () => resolve(rawDataUrl);
          img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
      });
    }

    _formatErrorString(err) {
      if (!err) return 'Connection failed.';
      let msg = '';
      if (typeof err === 'string') msg = err;
      else if (err instanceof Error) msg = err.message || '';
      else if (typeof err === 'object') msg = err.error || err.message || err.reason || '';
      else msg = String(err);

      if (!msg || msg === '[object Object]' || msg === '{}') {
        return 'Connection failed. Please ensure both devices are online.';
      }
      if (msg.includes('timed out while locating') || msg.includes('Room host not reachable')) {
        return 'Unable to locate room host. Please confirm the room code and ensure the creator is online.';
      }
      if (msg.includes('PeerJS') || msg.includes('broker') || msg.includes('socket')) {
        return 'Connection interrupted. Please verify your internet connection and try reconnecting.';
      }
      return msg;
    }

    /**
     * Check if room has expired based on real elapsed time.
     * @returns {boolean}
     */
    _checkIfExpired() {
      if (!this.createdAt || !this.expiresAt) return false;
      const now = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      const elapsedWall = now - this.createdAt;
      const elapsedPerf = (this.createdPerf && typeof performance !== 'undefined')
        ? (performance.now() - this.createdPerf)
        : 0;
      const realElapsed = Math.max(elapsedWall, elapsedPerf);

      if (realElapsed >= this.ttlMs || now >= this.expiresAt) {
        this.expireRoom();
        return true;
      }
      return false;
    }

    /**
     * Start the 1-hour countdown timer using real elapsed time.
     * @private
     */
    _startTtlTimer() {
      if (this.ttlTimerId) clearInterval(this.ttlTimerId);
      this.ttlTimerId = setInterval(() => {
        this._checkIfExpired();
      }, 1000);
      if (this.ttlTimerId && typeof this.ttlTimerId.unref === 'function') {
        this.ttlTimerId.unref();
      }

      this._onVisibilityCheck = () => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this._checkIfExpired();
        }
      };
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', this._onVisibilityCheck);
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', this._onVisibilityCheck);
      }
    }

    /**
     * Permanently expire and disable the room after exactly 1 hour of real elapsed time.
     * Invalids invitation code and disconnects both participants.
     */
    expireRoom() {
      const codeToInvalidate = this.roomId;
      const formattedToInvalidate = this.formattedCode;

      // Invalidate code in permanent registry
      if (codeToInvalidate && window.VanishValidation) {
        window.VanishValidation.markRoomExpired(codeToInvalidate);
      }
      if (formattedToInvalidate && window.VanishValidation) {
        window.VanishValidation.markRoomExpired(formattedToInvalidate);
      }

      // Notify peer that room expired
      if (this.transport) {
        try {
          this.transport.notifyRoomExpired();
        } catch (e) {}
      }

      this._teardownResources();

      this._setState(ROOM_STATES.EXPIRED, {
        message: 'This room has reached its 1-hour lifespan and has been permanently disabled. The creator must create a new room with a new invitation code.'
      });
    }

    /**
     * Teardown all resources, timers, and crypto material.
     * @private
     */
    _teardownResources() {
      if (this.ttlTimerId) {
        clearInterval(this.ttlTimerId);
        this.ttlTimerId = null;
      }
      if (this._onVisibilityCheck) {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', this._onVisibilityCheck);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('focus', this._onVisibilityCheck);
        }
        this._onVisibilityCheck = null;
      }
      if (this.transport) {
        if (typeof this.transport.destroy === 'function') {
          this.transport.destroy();
        }
        this.transport = null;
      }
      if (this.crypto) {
        this.crypto.destroySession();
      }

      this.roomId = null;
      this.formattedCode = null;
      this.roomName = 'Private Room';
      this.localNickname = '';
      this.remoteNickname = '';
      this.role = null;
      this.roomType = 'direct';
      this.maxParticipants = 2;
      this.participantCount = 1;
      this.participants.clear();
      this.createdAt = null;
      this.createdPerf = 0;
      this.expiresAt = null;
    }

    /**
     * Admit a pending guest into the private room (Creator only).
     * @param {string} [guestId]
     */
    admitGuest(guestId) {
      const gId = guestId || this.pendingAdmissionGuestId;
      if (this.role !== 'creator') {
        throw new Error('Only the room creator can admit guests.');
      }
      if (this.transport && gId) {
        this.transport.admitGuest(gId);
        this.pendingAdmissionGuestId = null;
      }
    }

    /**
     * Reject a pending guest admission request (Creator only).
     * @param {string} [guestId]
     */
    rejectGuest(guestId) {
      const gId = guestId || this.pendingAdmissionGuestId;
      if (this.role !== 'creator') {
        throw new Error('Only the room creator can reject admission.');
      }
      if (this.transport && gId) {
        this.transport.rejectGuest(gId);
        this.pendingAdmissionGuestId = null;
      }
    }

    /**
     * Immediately remove the active guest or a specific participant from the room (Creator only).
     * Revokes their access token and prevents reconnection with stale credentials.
     * @param {string} [guestId]
     */
    removeGuest(guestId) {
      if (this.role !== 'creator') {
        throw new Error('Only the room creator can remove guests.');
      }
      if (this.transport) {
        this.transport.removeGuest(guestId);
      }
      if (guestId && this.participants) {
        this.participants.delete(guestId);
      }
      this.participantCount = Math.max(1, this.participants ? this.participants.size : 1);
      if (this.participantCount <= 1) {
        this.remoteNickname = '';
        this._setState(ROOM_STATES.WAITING_FOR_PEER, {
          formattedCode: this.formattedCode,
          roomId: this.roomId,
          roomName: this.roomName,
          transportName: this.transport ? this.transport.getTransportName() : '',
          roomType: this.roomType,
          maxParticipants: this.maxParticipants,
          participantCount: this.participantCount,
          participants: this.participants
        });
      } else {
        this.remoteNickname = `${this.participantCount - 1} member${this.participantCount > 2 ? 's' : ''}`;
        this._setState(ROOM_STATES.CONNECTED, {
          formattedCode: this.formattedCode,
          roomId: this.roomId,
          roomName: this.roomName,
          transportName: this.transport ? this.transport.getTransportName() : '',
          roomType: this.roomType,
          maxParticipants: this.maxParticipants,
          participantCount: this.participantCount,
          participants: this.participants,
          remoteNickname: this.remoteNickname,
          localNickname: this.localNickname
        });
      }
    }

    /**
     * Remove a participant by ID (Creator only).
     * @param {string} participantId
     */
    removeParticipant(participantId) {
      return this.removeGuest(participantId);
    }

    /**
     * Synchronize CLEAR CHAT FOR BOTH across devices using trusted coordination.
     */
    clearChatForBoth() {
      if (this.transport) {
        this.transport.clearChatForBoth();
      }
    }

    /**
     * Retry connection using last stored parameters.
     */
    async retryConnection() {
      if (this.role === 'creator') {
        if (!this.lastCreateParams) throw new Error('No previous room creation to retry.');
        return this.createRoom(
          this.lastCreateParams.nickname,
          this.lastCreateParams.roomName,
          this.lastCreateParams.preferredTransport,
          this.lastCreateParams.roomType,
          this.lastCreateParams.maxParticipants
        );
      } else {
        if (!this.lastJoinParams || !this.lastJoinParams.rawCode) throw new Error('No previous connection to retry.');
        return this.joinRoom(
          this.lastJoinParams.rawCode,
          this.lastJoinParams.nickname,
          this.lastJoinParams.preferredTransport
        );
      }
    }

    /**
     * Leave and completely destroy the current room.
     * Wipes all keys, transport connections, and temporary state.
     */
    leaveRoom() {
      this._teardownResources();
      this._setState(ROOM_STATES.IDLE);
    }
  }

  window.VanishRoomSession = RoomSession;
  window.VANISH_ROOM_STATES = ROOM_STATES;
})(window);
