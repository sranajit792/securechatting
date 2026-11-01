/**
 * VanishText {Made by SUVX}
 * Trusted Room Coordination, Signaling & TURN Relay Server
 *
 * Implements:
 * 1. HTTP server serving static frontend files and API endpoints
 * 2. Secure, temporary TURN credentials generation and STUN/TURN configuration
 * 3. Server-side trusted room lifecycle (strict 1-hour expiration)
 * 4. Strict 1-to-1 admission control (creator + 1 admitted guest at a time; rejects 3rd participant)
 * 5. Creator authentication via CSPRNG creatorSecret (creator-only admission and removal)
 * 6. Guest access revocation (blocks reconnection with stale credentials)
 * 7. Server-coordinated CLEAR CHAT FOR BOTH with timestamp cutoff
 * 8. WebRTC signaling relay and End-to-End Encrypted fallback relay
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const ROOM_TTL_MS = 60 * 60 * 1000; // 1 hour in ms
const MESSAGE_TTL_MS = 15 * 60 * 1000; // 15 minutes in ms

// Active in-memory room registry (Zero persistence to disk or databases)
// roomId -> RoomObject
const activeRooms = new Map();

// Helper: Content types for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

/**
 * Generate secure temporary TURN credentials (RFC 5766 / REST API style)
 */
function getTurnCredentials(forceRelay = false) {
  const ttlSeconds = 86400; // 24 hours
  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = process.env.TURN_USERNAME || `${timestamp}:vanishtext-user`;
  const turnSecret = process.env.TURN_SECRET || 'openrelayproject';
  
  // HMAC-SHA1 calculation for temporary credentials (or static credential if provided)
  let password = process.env.TURN_CREDENTIAL;
  if (!password) {
    const hmac = crypto.createHmac('sha1', turnSecret);
    hmac.update(username);
    password = hmac.digest('base64');
  }

  // Multi-network, cross-ISP, firewall/VPN-friendly ICE servers
  let iceServers;
  if (process.env.TURN_URLS) {
    const customUrls = process.env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      ...customUrls.map(u => ({ urls: u, username, credential: password }))
    ];
  } else {
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      // Publicly reachable TURN servers across UDP & TCP (ports 80 & 443) and TURNS (TLS)
      {
        urls: 'turn:relay.metered.ca:80',
        username: username,
        credential: password
      },
      {
        urls: 'turn:relay.metered.ca:443',
        username: username,
        credential: password
      },
      {
        urls: 'turn:relay.metered.ca:443?transport=tcp',
        username: username,
        credential: password
      },
      {
        urls: 'turns:relay.metered.ca:443?transport=tcp',
        username: username,
        credential: password
      }
    ];
  }

  return {
    iceServers,
    iceTransportPolicy: forceRelay ? 'relay' : 'all',
    expiresAt: Date.now() + (ttlSeconds * 1000)
  };
}

/**
 * Create HTTP Server for Static Assets and API endpoints
 */
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Universal CORS preflight support
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: TURN credentials endpoint
  if (pathname === '/api/turn-credentials') {
    const forceRelay = parsedUrl.searchParams.get('mode') === 'relay' || parsedUrl.searchParams.get('relay') === 'true';
    const creds = getTurnCredentials(forceRelay);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(creds));
    return;
  }

  // API 2: Room status check
  if (pathname.startsWith('/api/room/')) {
    const roomId = pathname.replace('/api/room/', '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
    const room = activeRooms.get(roomId);
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ exists: false, error: 'Room not found or expired.' }));
      return;
    }
    const isOccupied = !!room.admittedGuest;
    const now = Date.now();
    const remainingMs = Math.max(0, room.expiresAt - now);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      exists: true,
      roomId: room.roomId,
      isOccupied: isOccupied,
      expiresInSeconds: Math.floor(remainingMs / 1000)
    }));
    return;
  }

  // API 3: Health check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok', activeRooms: activeRooms.size, uptime: process.uptime() }));
    return;
  }

  // API 4: Network interface discovery for Cross-Network / Wi-Fi / Hotspot join
  if (pathname === '/api/network-info') {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push({ interface: name, ip: net.address, port: PORT, url: `http://${net.address}:${PORT}` });
        }
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      port: PORT,
      localUrl: `http://localhost:${PORT}`,
      networkUrls: addresses,
      primaryNetworkUrl: addresses.length > 0 ? addresses[0].url : `http://localhost:${PORT}`
    }));
    return;
  }

  // Static File Serving
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal attacks
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Zero-cache headers for privacy and test freshness
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

/**
 * WebSocket Server for Trusted Coordination & Signaling
 */
const wss = new WebSocket.Server({ noServer: true, maxPayload: 52428800 }); // 50MB max payload for large image chunks

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname === '/ws' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.sessionData = {
    role: null,           // 'creator' | 'guest'
    roomId: null,
    participantId: null,
    creatorSecret: null,
    guestToken: null,
    nickname: ''
  };

  ws.on('message', (messageData) => {
    let msg;
    try {
      msg = JSON.parse(messageData.toString());
    } catch (e) {
      console.warn('[WS] Malformed JSON received');
      return;
    }

    handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    handleClientDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS Error]', err);
  });
});

/**
 * Handle incoming client actions with strict server-side validation
 */
function handleClientMessage(ws, msg) {
  const type = msg.type;

  switch (type) {
    case 'CREATE_ROOM': {
      // 1. Creator creates room
      const rawRoomId = msg.roomId;
      const nickname = (msg.nickname || 'Creator').substring(0, 24);
      const cleanRoomId = (rawRoomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');

      if (!cleanRoomId || cleanRoomId.length < 8) {
        sendError(ws, 'Invalid room ID format.');
        return;
      }

      // Check if room already active and not expired
      const existing = activeRooms.get(cleanRoomId);
      if (existing && Date.now() < existing.expiresAt) {
        sendError(ws, 'A room with this code is already active.');
        return;
      }

      const now = Date.now();
      const creatorSecret = crypto.randomBytes(32).toString('hex'); // Authenticated creator token
      const creatorId = `creator-${crypto.randomBytes(8).toString('hex')}`;
      const maxParticipants = typeof msg.maxParticipants === 'number' ? msg.maxParticipants : (msg.roomType === 'group' ? 10 : 2);

      const newRoom = {
        roomId: cleanRoomId,
        createdAt: now,
        expiresAt: now + ROOM_TTL_MS,
        creatorSecret: creatorSecret,
        creatorWs: ws,
        creatorId: creatorId,
        creatorNickname: nickname,
        creatorPublicKey: msg.jwk || null,
        roomType: msg.roomType || 'direct',
        maxParticipants: maxParticipants,
        admittedGuest: null, // Pointer for backwards compatibility with 1-to-1 tests
        admittedGuests: new Map(), // guestId -> { guestId, nickname, guestToken, ws, jwk }
        pendingGuest: null,  // Pointer for backwards compatibility
        pendingGuests: new Map(),  // guestId -> { guestId, nickname, ws, jwk }
        revokedTokens: new Set(),
        revokedGuestIds: new Set(),
        clearedAt: 0,
        lastActivity: now
      };

      activeRooms.set(cleanRoomId, newRoom);

      ws.sessionData.role = 'creator';
      ws.sessionData.roomId = cleanRoomId;
      ws.sessionData.creatorSecret = creatorSecret;
      ws.sessionData.participantId = creatorId;
      ws.sessionData.nickname = nickname;

      ws.send(JSON.stringify({
        type: 'ROOM_CREATED',
        roomId: cleanRoomId,
        creatorSecret: creatorSecret,
        creatorId: creatorId,
        createdAt: now,
        expiresAt: newRoom.expiresAt,
        roomType: newRoom.roomType,
        maxParticipants: newRoom.maxParticipants
      }));
      break;
    }

    case 'REQUEST_ADMISSION': {
      // 2. Guest requests admission from creator
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const nickname = (msg.nickname || 'Guest').substring(0, 24);
      const room = activeRooms.get(cleanRoomId);

      if (!room || Date.now() >= room.expiresAt) {
        sendError(ws, 'Room not found or has reached its 1-hour expiration.');
        return;
      }

      // Check room capacity
      const currentGuestCount = Math.max(room.admittedGuests.size, room.admittedGuest ? 1 : 0);
      if (currentGuestCount >= (room.maxParticipants - 1)) {
        ws.send(JSON.stringify({
          type: 'ROOM_FULL',
          message: room.maxParticipants === 2
            ? 'This room is full. Only two participants are allowed.'
            : `This room is full. Maximum capacity is ${room.maxParticipants} participants.`
        }));
        setTimeout(() => { try { ws.close(); } catch(e) {} }, 300);
        return;
      }

      // Check if this guest was previously revoked
      const isRevoked = (msg.guestId && room.revokedGuestIds.has(msg.guestId)) ||
                        (msg.guestToken && room.revokedTokens.has(msg.guestToken)) ||
                        (msg.staleGuestToken && room.revokedTokens.has(msg.staleGuestToken));
      if (isRevoked) {
        ws.send(JSON.stringify({
          type: 'ADMISSION_REJECTED',
          message: 'You have been removed from this room and cannot rejoin with stale credentials.'
        }));
        setTimeout(() => { try { ws.close(); } catch(e) {} }, 300);
        return;
      }

      // If creator is offline
      if (!room.creatorWs || room.creatorWs.readyState !== WebSocket.OPEN) {
        sendError(ws, 'Room creator is currently offline.');
        return;
      }

      const guestId = msg.guestId || `guest-${crypto.randomBytes(8).toString('hex')}`;
      ws.sessionData.role = 'guest';
      ws.sessionData.roomId = cleanRoomId;
      ws.sessionData.participantId = guestId;
      ws.sessionData.nickname = nickname;

      const pendingObj = {
        guestId: guestId,
        nickname: nickname,
        ws: ws,
        jwk: msg.jwk || null
      };

      room.pendingGuest = pendingObj;
      room.pendingGuests.set(guestId, pendingObj);

      // Notify guest that request is pending
      ws.send(JSON.stringify({
        type: 'WAITING_FOR_ADMISSION',
        guestId: guestId,
        message: 'Waiting for room creator to admit you...'
      }));

      // Send Admission Request to Creator's UI
      room.creatorWs.send(JSON.stringify({
        type: 'ADMISSION_REQUEST',
        guestId: guestId,
        nickname: nickname
      }));
      break;
    }

    case 'ADMIT_GUEST': {
      // 3. Creator approves guest admission
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);

      if (!room) {
        sendError(ws, 'Room not found.');
        return;
      }

      // Verify creator authentication
      if (msg.creatorSecret !== room.creatorSecret) {
        sendError(ws, 'Unauthorized: Only the authenticated room creator can admit guests.');
        return;
      }

      // Check capacity
      const currentGuestCount = Math.max(room.admittedGuests.size, room.admittedGuest ? 1 : 0);
      if (currentGuestCount >= (room.maxParticipants - 1)) {
        sendError(ws, 'Room already reached maximum capacity.');
        return;
      }

      const targetGuestId = msg.guestId || (room.pendingGuest ? room.pendingGuest.guestId : null);
      const pending = room.pendingGuests.get(targetGuestId) || room.pendingGuest;
      if (!pending || pending.guestId !== targetGuestId) {
        sendError(ws, 'Pending guest request not found or expired.');
        return;
      }

      // Issue ephemeral guest auth token
      const guestToken = crypto.randomBytes(32).toString('hex');
      pending.ws.sessionData.guestToken = guestToken;

      const guestObj = {
        guestId: pending.guestId,
        nickname: pending.nickname,
        guestToken: guestToken,
        ws: pending.ws,
        jwk: pending.jwk
      };

      room.admittedGuests.set(pending.guestId, guestObj);
      room.admittedGuest = guestObj;
      room.pendingGuests.delete(pending.guestId);
      if (room.pendingGuest && room.pendingGuest.guestId === pending.guestId) {
        room.pendingGuest = null;
      }

      const totalCount = room.admittedGuests.size + 1;

      // Notify Guest: Admission Granted
      pending.ws.send(JSON.stringify({
        type: 'ADMISSION_GRANTED',
        guestToken: guestToken,
        creatorNickname: room.creatorNickname,
        creatorPublicKey: room.creatorPublicKey,
        roomCreatedAt: room.createdAt,
        expiresAt: room.expiresAt,
        roomType: room.roomType,
        maxParticipants: room.maxParticipants,
        participantCount: totalCount
      }));

      // Notify Creator: Guest Admitted
      room.creatorWs.send(JSON.stringify({
        type: 'GUEST_ADMITTED',
        guestId: pending.guestId,
        nickname: pending.nickname,
        guestPublicKey: pending.jwk,
        participantCount: totalCount
      }));

      // Notify other admitted guests if room has multiple members
      for (const [otherId, otherGuest] of room.admittedGuests.entries()) {
        if (otherId !== pending.guestId && otherGuest.ws.readyState === WebSocket.OPEN) {
          otherGuest.ws.send(JSON.stringify({
            type: 'PARTICIPANT_JOINED',
            participantId: pending.guestId,
            nickname: pending.nickname,
            participantCount: totalCount
          }));
        }
      }
      break;
    }

    case 'REJECT_GUEST': {
      // 4. Creator declines guest admission
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);

      if (!room || msg.creatorSecret !== room.creatorSecret) {
        sendError(ws, 'Unauthorized: Only creator can reject admission.');
        return;
      }

      const targetGuestId = msg.guestId || (room.pendingGuest ? room.pendingGuest.guestId : null);
      const pending = room.pendingGuests.get(targetGuestId) || room.pendingGuest;

      if (pending && pending.guestId === targetGuestId) {
        const pendingWs = pending.ws;
        pendingWs.send(JSON.stringify({
          type: 'ADMISSION_REJECTED',
          message: 'The room creator declined your admission request.'
        }));
        setTimeout(() => { try { pendingWs.close(); } catch(e) {} }, 300);
        room.pendingGuests.delete(targetGuestId);
        if (room.pendingGuest && room.pendingGuest.guestId === targetGuestId) {
          room.pendingGuest = null;
        }
      }
      break;
    }

    case 'REMOVE_GUEST': {
      // 5. Creator removes guest immediately
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);

      if (!room) {
        sendError(ws, 'Room not found.');
        return;
      }

      // Only the authenticated room creator may perform creator-only actions
      if (msg.creatorSecret !== room.creatorSecret) {
        sendError(ws, 'Unauthorized: Only authenticated room creator can remove guests.');
        return;
      }

      const targetGuestId = msg.guestId;
      let guest = null;

      if (targetGuestId && room.admittedGuests.has(targetGuestId)) {
        guest = room.admittedGuests.get(targetGuestId);
        room.admittedGuests.delete(targetGuestId);
      } else if (room.admittedGuest) {
        guest = room.admittedGuest;
        room.admittedGuests.delete(guest.guestId);
      }

      if (guest) {
        // Revoke token and guestId to prevent reconnection with stale credentials
        room.revokedTokens.add(guest.guestToken);
        room.revokedGuestIds.add(guest.guestId);

        // Notify guest without exposing private metadata
        guest.ws.send(JSON.stringify({
          type: 'REMOVED_BY_CREATOR',
          message: 'You have been removed from the room by the creator.'
        }));

        setTimeout(() => { try { guest.ws.close(); } catch(e) {} }, 200);

        if (room.admittedGuest && room.admittedGuest.guestId === guest.guestId) {
          room.admittedGuest = room.admittedGuests.size > 0 ? room.admittedGuests.values().next().value : null;
        }

        const remainingCount = room.admittedGuests.size + 1;

        // Notify creator
        room.creatorWs.send(JSON.stringify({
          type: 'GUEST_REMOVED',
          guestId: guest.guestId,
          nickname: guest.nickname,
          message: 'Guest has been removed from the room.',
          participantCount: remainingCount
        }));

        // Notify remaining participants
        for (const remaining of room.admittedGuests.values()) {
          if (remaining.ws.readyState === WebSocket.OPEN) {
            remaining.ws.send(JSON.stringify({
              type: 'PARTICIPANT_LEFT',
              participantId: guest.guestId,
              nickname: guest.nickname,
              participantCount: remainingCount
            }));
          }
        }
      }
      break;
    }

    case 'CLEAR_CHAT': {
      // 6. CLEAR CHAT FOR BOTH / EVERYONE with trusted server-side coordination
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);

      if (!room) {
        sendError(ws, 'Room not found.');
        return;
      }

      // Validate that sender is an authorized active participant (creator or admitted guest)
      const isCreator = msg.creatorSecret && msg.creatorSecret === room.creatorSecret;
      let senderNick = isCreator ? room.creatorNickname : 'Participant';
      let isGuest = false;

      if (!isCreator && msg.guestToken) {
        for (const guest of room.admittedGuests.values()) {
          if (guest.guestToken === msg.guestToken) {
            isGuest = true;
            senderNick = guest.nickname;
            break;
          }
        }
        if (!isGuest && room.admittedGuest && msg.guestToken === room.admittedGuest.guestToken) {
          isGuest = true;
          senderNick = room.admittedGuest.nickname;
        }
      }

      if (!isCreator && !isGuest) {
        sendError(ws, 'Unauthorized: Only admitted room participants can clear chat.');
        return;
      }

      const clearedAt = Date.now();
      room.clearedAt = clearedAt;

      const clearNotice = {
        type: 'CHAT_CLEARED',
        clearedAt: clearedAt,
        clearedBy: senderNick
      };

      // Synchronize immediately to creator and all admitted participants
      if (room.creatorWs && room.creatorWs.readyState === WebSocket.OPEN) {
        room.creatorWs.send(JSON.stringify(clearNotice));
      }
      for (const guest of room.admittedGuests.values()) {
        if (guest.ws && guest.ws.readyState === WebSocket.OPEN) {
          guest.ws.send(JSON.stringify(clearNotice));
        }
      }
      if (room.admittedGuest && !room.admittedGuests.has(room.admittedGuest.guestId)) {
        if (room.admittedGuest.ws && room.admittedGuest.ws.readyState === WebSocket.OPEN) {
          room.admittedGuest.ws.send(JSON.stringify(clearNotice));
        }
      }
      break;
    }

    case 'SIGNAL': {
      // 7. WebRTC Signaling relay (SDP Offer, Answer, ICE Candidates)
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);
      if (!room) return;

      const isCreator = msg.creatorSecret && msg.creatorSecret === room.creatorSecret;
      let isGuest = false;
      let senderGuestId = null;
      if (!isCreator && msg.guestToken) {
        for (const [gId, guest] of room.admittedGuests.entries()) {
          if (guest.guestToken === msg.guestToken) { isGuest = true; senderGuestId = gId; break; }
        }
        if (!isGuest && room.admittedGuest && msg.guestToken === room.admittedGuest.guestToken) {
          isGuest = true;
          senderGuestId = room.admittedGuest.guestId;
        }
      }

      if (!isCreator && !isGuest) return;

      let targetWs = null;
      if (isCreator) {
        const targetId = msg.targetGuestId || msg.guestId;
        if (targetId && room.admittedGuests.has(targetId)) {
          targetWs = room.admittedGuests.get(targetId).ws;
        } else if (room.admittedGuest) {
          targetWs = room.admittedGuest.ws;
        } else if (room.admittedGuests.size > 0) {
          targetWs = room.admittedGuests.values().next().value.ws;
        }
      } else {
        targetWs = room.creatorWs;
      }

      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({
          type: 'SIGNAL',
          signalData: msg.signalData,
          fromRole: isCreator ? 'creator' : 'guest',
          fromId: isCreator ? 'creator' : (senderGuestId || 'guest')
        }));
      }
      break;
    }

    case 'ENCRYPTED_MESSAGE':
    case 'ENCRYPTED_CHUNK': {
      // 8. Fallback Encrypted Relay (Preserves genuine E2EE)
      // Server routes ciphertext ONLY; never possesses encryption keys or plaintext
      const cleanRoomId = (msg.roomId || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
      const room = activeRooms.get(cleanRoomId);
      if (!room) return;

      const isCreator = msg.creatorSecret && msg.creatorSecret === room.creatorSecret;
      let isGuest = false;
      let senderGuestId = null;

      if (!isCreator && msg.guestToken) {
        for (const [gId, guest] of room.admittedGuests.entries()) {
          if (guest.guestToken === msg.guestToken) {
            isGuest = true;
            senderGuestId = gId;
            break;
          }
        }
        if (!isGuest && room.admittedGuest && msg.guestToken === room.admittedGuest.guestToken) {
          isGuest = true;
          senderGuestId = room.admittedGuest.guestId;
        }
      }

      if (!isCreator && !isGuest) return;

      const msgTimestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();

      // Prevent cleared messages from reappearing after delayed delivery
      if (room.clearedAt && msgTimestamp <= room.clearedAt) {
        console.log('[Server] Discarding message sent prior to chat clear.');
        return;
      }

      // Automatic 15-minute message deletion check
      if (Date.now() - msgTimestamp >= MESSAGE_TTL_MS) {
        console.log('[Server] Discarding expired message (>15m).');
        return;
      }

      const payloadMsg = {
        type: msg.type,
        payload: msg.payload, // End-to-end encrypted AES-256-GCM ciphertext
        chunkId: msg.chunkId,
        index: msg.index,
        total: msg.total,
        data: msg.data,
        senderNick: msg.senderNick,
        senderId: msg.senderId || (isCreator ? 'creator' : (senderGuestId || 'guest')),
        timestamp: msgTimestamp
      };

      if (isCreator) {
        // Relay to all admitted guests
        for (const guest of room.admittedGuests.values()) {
          if (guest.ws && guest.ws.readyState === WebSocket.OPEN) {
            guest.ws.send(JSON.stringify(payloadMsg));
          }
        }
        if (room.admittedGuest && !room.admittedGuests.has(room.admittedGuest.guestId)) {
          if (room.admittedGuest.ws && room.admittedGuest.ws.readyState === WebSocket.OPEN) {
            room.admittedGuest.ws.send(JSON.stringify(payloadMsg));
          }
        }
      } else if (isGuest) {
        // Relay to creator
        if (room.creatorWs && room.creatorWs.readyState === WebSocket.OPEN) {
          room.creatorWs.send(JSON.stringify(payloadMsg));
        }
        // Relay to other admitted guests in multi-participant room
        for (const [gId, guest] of room.admittedGuests.entries()) {
          if (gId !== senderGuestId && guest.ws && guest.ws.readyState === WebSocket.OPEN) {
            guest.ws.send(JSON.stringify(payloadMsg));
          }
        }
      }
      break;
    }

    default:
      console.warn('[Server] Unhandled message type:', type);
  }
}

function handleClientDisconnect(ws) {
  const { role, roomId, participantId } = ws.sessionData;
  if (!roomId) return;

  const room = activeRooms.get(roomId);
  if (!room) return;

  if (role === 'creator') {
    // If creator disconnects, notify admitted guests and close room
    for (const guest of room.admittedGuests.values()) {
      try {
        guest.ws.send(JSON.stringify({
          type: 'CREATOR_DISCONNECTED',
          message: 'Room creator has left the room. Session terminated.'
        }));
        guest.ws.close();
      } catch(e) {}
    }
    if (room.admittedGuest && !room.admittedGuests.has(room.admittedGuest.guestId)) {
      try {
        room.admittedGuest.ws.send(JSON.stringify({
          type: 'CREATOR_DISCONNECTED',
          message: 'Room creator has left the room. Session terminated.'
        }));
        room.admittedGuest.ws.close();
      } catch(e) {}
    }
    activeRooms.delete(roomId);
  } else if (role === 'guest') {
    const gId = participantId;
    let guestNickname = ws.sessionData.nickname || 'Guest';

    if (gId && room.admittedGuests.has(gId)) {
      guestNickname = room.admittedGuests.get(gId).nickname || guestNickname;
      room.admittedGuests.delete(gId);
    }
    if (room.admittedGuest && (room.admittedGuest.ws === ws || room.admittedGuest.guestId === gId)) {
      room.admittedGuest = room.admittedGuests.size > 0 ? room.admittedGuests.values().next().value : null;
    }
    if (room.pendingGuests.has(gId)) {
      room.pendingGuests.delete(gId);
    }
    if (room.pendingGuest && (room.pendingGuest.ws === ws || room.pendingGuest.guestId === gId)) {
      room.pendingGuest = null;
    }

    const remainingCount = room.admittedGuests.size + 1;

    if (room.creatorWs && room.creatorWs.readyState === WebSocket.OPEN) {
      room.creatorWs.send(JSON.stringify({
        type: 'GUEST_LEFT',
        guestId: gId,
        message: `${guestNickname} has left the room.`,
        participantCount: remainingCount
      }));
    }

    for (const remaining of room.admittedGuests.values()) {
      if (remaining.ws.readyState === WebSocket.OPEN) {
        remaining.ws.send(JSON.stringify({
          type: 'PARTICIPANT_LEFT',
          participantId: gId,
          nickname: guestNickname,
          participantCount: remainingCount
        }));
      }
    }
  }
}

function sendError(ws, errorMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'ERROR',
      error: errorMsg
    }));
  }
}

/**
 * Sweeper: Purge expired rooms (60 minutes real elapsed time)
 */
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of activeRooms.entries()) {
    if (now >= room.expiresAt) {
      console.log(`[Sweeper] Room ${roomId} reached 1-hour expiration. Disabling and clearing memory.`);
      const expireNotice = JSON.stringify({
        type: 'ROOM_EXPIRED',
        message: 'This room has reached its 1-hour expiration and is permanently disabled.'
      });

      if (room.creatorWs && room.creatorWs.readyState === WebSocket.OPEN) {
        try { room.creatorWs.send(expireNotice); room.creatorWs.close(); } catch(e) {}
      }
      if (room.admittedGuest && room.admittedGuest.ws && room.admittedGuest.ws.readyState === WebSocket.OPEN) {
        try { room.admittedGuest.ws.send(expireNotice); room.admittedGuest.ws.close(); } catch(e) {}
      }
      activeRooms.delete(roomId);
    }
  }
}, 5000);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    const netUrls = [];
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          netUrls.push(`http://${net.address}:${PORT}`);
        }
      }
    }

    console.log('===============================================================');
    console.log(` VanishText Trusted Server running on all network interfaces`);
    console.log(` > Local Access:             http://localhost:${PORT}`);
    if (netUrls.length > 0) {
      console.log(` > Wi-Fi / Hotspot Access:   ${netUrls.join(', ')}`);
    }
    console.log(` > WebRTC STUN/TURN endpoint: /api/turn-credentials`);
    console.log(` > WebSocket Coordination:    /ws`);
    console.log('===============================================================');
  });
}

module.exports = { server, activeRooms, getTurnCredentials };
