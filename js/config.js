/**
 * VanishText {Made by SUVX}
 * Active Configuration File
 *
 * Frontend relies strictly on public endpoints and client-side Web Crypto.
 * No secret administrative keys or credentials belong in this file.
 */

window.CHATSPACE_CONFIG = {
  appName: 'VanishText',
  authorBadge: 'Made by SUVX',
  tagline: 'Private conversations. Just two people. Text only.',

  // Transport mode: 'auto' will connect to trusted server coordination & WebRTC (with TURN relay support),
  // with fallback to PeerJS or BroadcastChannel for offline same-machine tab testing.
  transportMode: 'auto',

  // Trusted Signaling & Coordination Server
  signaling: {
    serverUrl: '', // Auto-detected from window.location (e.g. ws://localhost:8080/ws)
    turnApiUrl: '/api/turn-credentials',
    forceTurnRelay: false // Set to true to explicitly test TURN relay mode
  },

  // Connection Lifecycle & Timeout Management
  connection: {
    signalingTimeoutMs: 15000,
    negotiationTimeoutMs: 15000,
    totalTimeoutMs: 30000,
    heartbeatIntervalMs: 20000,
    maxJoinRetries: 5,
    retryDelayMs: 1500
  },

  // Multi-network WebRTC STUN & TURN Relay Configuration
  webrtc: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      // Multi-network TURN relays across UDP, TCP, and TLS (Ports 80 & 443)
      {
        urls: 'turn:relay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:relay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turns:relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  },

  peerjs: {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:relay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:relay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:relay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turns:relay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10
    }
  },


  supabase: {
    url: '',
    anonKey: ''
  },

  room: {
    maxParticipants: 2,
    groupMaxParticipants: 10,
    roomTtlMinutes: 60,
    codeLength: 12,
    codeCharset: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  },

  messaging: {
    maxMessageLength: 2000,
    rateLimitMax: 5,
    rateLimitWindowMs: 2000,
    allowedFormats: ['text'],
    messageTtlMinutes: 15
  },

  security: {
    privacyBlurDefault: false,
    preventShortcuts: true,
    sessionStorageBlocked: true
  }
};
