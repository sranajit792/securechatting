/**
 * VanishText {Made by SUVX}
 * Configuration Example
 *
 * Copy this file to config.js to adjust settings.
 * NEVER commit private server credentials or admin keys.
 */

window.CHATSPACE_CONFIG = {
  // Application branding
  appName: 'VanishText',
  authorBadge: 'Made by SUVX',
  tagline: 'Private conversations. Just two people. Text only.',

  // Transport configuration: 'auto', 'peerjs', 'broadcast', or 'supabase'
  // 'auto' prefers PeerJS (WebRTC P2P between real separate devices),
  // with fallback to BroadcastChannel for offline / single-machine tab testing.
  transportMode: 'auto',

  // PeerJS WebRTC configuration (for true cross-device internet communication)
  // Uses public, free STUN servers and the standard PeerJS cloud signaling broker.
  peerjs: {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    }
  },

  // Optional Supabase Realtime configuration (managed websocket relay)
  // If provided, can be selected for enterprise websocket fallback.
  // DO NOT use service_role keys here — only the public anon key.
  supabase: {
    url: '',      // e.g. 'https://your-project.supabase.co'
    anonKey: ''   // public anon key
  },

  // Room parameters
  room: {
    maxParticipants: 2,           // Default 1-to-1 limit
    groupMaxParticipants: 10,     // Group chat limit (up to 10 participants)
    roomTtlMinutes: 60,           // Room expires after 60 minutes
    codeLength: 12,               // 12 alphanumeric characters (e.g. AB7K-M9QP-X4RT)
    codeCharset: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // Unambiguous characters (no 0/O, 1/I)
  },

  // Message constraints
  messaging: {
    maxMessageLength: 2000,       // Strict length limit
    rateLimitMax: 5,              // Max 5 messages...
    rateLimitWindowMs: 2000,      // ...per 2000ms window
    allowedFormats: ['text'],     // STRICT TEXT ONLY: No images, files, audio, video
    messageTtlMinutes: 15         // Every message automatically disappears after exactly 15 minutes
  },

  // Security & Privacy Deterrents
  security: {
    privacyBlurDefault: true,     // Blur chat on tab unfocus or background
    preventShortcuts: true,       // Intercept F12, Ctrl+Shift+I, PrintScreen, Ctrl+U, etc.
    sessionStorageBlocked: true   // Strictly verify zero persistence
  }
};
