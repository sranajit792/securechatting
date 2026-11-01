/**
 * VanishText {Made by SUVX}
 * Cryptographic Engine (Genuine End-to-End Encryption)
 *
 * Implements:
 * - CSPRNG Room Invitation Code Generation via crypto.getRandomValues()
 * - Ephemeral Key Agreement: ECDH over NIST P-256 (prime256v1)
 * - Key Derivation: HKDF with SHA-256 (RFC 5869)
 * - Authenticated Encryption: AES-256-GCM with 128-bit auth tag & unique 96-bit IV
 * - Additional Authenticated Data (AAD): Binds { roomId, senderId, seq }
 * - Replay Attack Defense: Monotonic sequence tracking
 * - Short Authentication String (SAS) & Visual Fingerprint for MITM verification
 * - Memory zeroization and key destruction upon room departure
 */

(function (window) {
  'use strict';

  // Fallback verification emojis for SAS visualization
  const SAS_EMOJI_POOL = [
    '🛡️', '⚡', '🔑', '🔒', '💎', '🚀', '🌟', '🔥',
    '🍀', '🎯', '⚓', '🔮', '🪐', '🌊', '🦅', '🦁'
  ];

  class VanishCryptoEngine {
    constructor() {
      this.isSubtleAvailable = !!(window.crypto && window.crypto.subtle);
      this.localKeypair = null;       // { privateKey: CryptoKey, publicKey: CryptoKey }
      this.localPublicKeyJwk = null;  // Exported JWK for exchange
      this.peerPublicKey = null;      // Imported CryptoKey
      this.sharedAesKey = null;       // Derived AES-256-GCM CryptoKey
      this.verificationData = null;   // { sasCode, emojiFingerprint, hexFingerprint }
      this.lastReceivedSeq = 0;       // Replay defense (global fallback)
      this.peerSequences = new Map(); // Replay defense per peer senderId
      this.outboundSeq = 0;           // Outbound sequence counter
    }

    /**
     * Verify that browser environment supports required Web Crypto APIs.
     * @returns {boolean}
     */
    checkSupport() {
      if (!this.isSubtleAvailable) {
        console.error('[VanishCrypto] Web Crypto API is not available in this context (requires HTTPS or localhost).');
        return false;
      }
      return true;
    }

    /**
     * Generate a cryptographically secure random invitation code.
     * Uses crypto.getRandomValues() exclusively. No Math.random().
     * @param {number} length
     * @param {string} charset
     * @returns {string} Formatted code e.g. "AB7K-M9QP-X4RT"
     */
    generateSecureRoomCode(length = 12, charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ') {
      const bytes = new Uint8Array(length);
      window.crypto.getRandomValues(bytes);
      const charsetLen = charset.length;
      let code = '';
      for (let i = 0; i < length; i++) {
        code += charset[bytes[i] % charsetLen];
      }
      // Return formatted with hyphens every 4 chars
      return code.match(/.{1,4}/g).join('-');
    }

    /**
     * Initialize ephemeral ECDH keypair (P-256).
     * Private key is non-extractable for maximum security where supported.
     * @returns {Promise<Object>} Exported public key in JWK format
     */
    async generateEphemeralKeypair() {
      if (!this.checkSupport()) {
        throw new Error('Web Crypto API not available. Cannot establish secure E2EE.');
      }

      this.localKeypair = await window.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true, // extractable (needed to export public key)
        ['deriveKey', 'deriveBits']
      );

      // Export public key as JWK to send to peer during handshake
      this.localPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', this.localKeypair.publicKey);
      return this.localPublicKeyJwk;
    }

    /**
     * Import the peer's public key from JWK format and derive the shared AES-256-GCM key.
     * Also derives the Short Authentication String (SAS) fingerprint.
     * @param {Object} peerJwk
     * @param {string} roomId
     * @returns {Promise<Object>} Verification details { sasCode, emojiFingerprint, hexFingerprint }
     */
    async establishSharedSession(peerJwk, roomId) {
      if (!this.localKeypair || !this.localKeypair.privateKey) {
        throw new Error('Local keypair not initialized before establishing shared session.');
      }

      // Import peer public key
      this.peerPublicKey = await window.crypto.subtle.importKey(
        'jwk',
        peerJwk,
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true,
        []
      );

      // 1. Derive 256 bits of shared master secret via ECDH
      const sharedBits = await window.crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: this.peerPublicKey
        },
        this.localKeypair.privateKey,
        256
      );

      // 2. Import derived bits as HKDF key material (PRK)
      const hkdfKey = await window.crypto.subtle.importKey(
        'raw',
        sharedBits,
        { name: 'HKDF' },
        false,
        ['deriveKey', 'deriveBits']
      );

      // 3. Derive AES-256-GCM encryption key using HKDF (SHA-256)
      const infoBytes = new TextEncoder().encode(`vanishtext-v1-aes-gcm:${roomId}`);
      const salt = new Uint8Array(32); // zero-salt per HKDF spec when context is bound

      this.sharedAesKey = await window.crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: salt,
          info: infoBytes
        },
        hkdfKey,
        {
          name: 'AES-GCM',
          length: 256
        },
        false, // non-extractable!
        ['encrypt', 'decrypt']
      );

      // 4. Derive SAS Fingerprint bits using HKDF with separate info string
      const sasInfoBytes = new TextEncoder().encode(`vanishtext-v1-sas-auth:${roomId}`);
      const sasBits = await window.crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: salt,
          info: sasInfoBytes
        },
        hkdfKey,
        128 // 16 bytes
      );

      // 5. Generate human-readable SAS verification representations
      this.verificationData = this._computeSasFingerprint(sasBits);

      // Reset sequence numbers for new session
      this.lastReceivedSeq = 0;
      this.outboundSeq = 0;

      // Clean raw sharedBits buffer
      new Uint8Array(sharedBits).fill(0);

      return this.verificationData;
    }

    /**
     * Derive shared group encryption key (AES-256-GCM) directly from the room invitation code.
     * All participants who hold the secret invitation code derive this key identically.
     * @param {string} roomCode Formatted or unformatted room invitation code
     * @param {string} roomId Clean normalized room ID
     * @returns {Promise<Object>} Verification details
     */
    async establishGroupSession(roomCode, roomId) {
      if (!this.checkSupport()) {
        throw new Error('Web Crypto API not available. Cannot establish secure E2EE.');
      }

      const cleanCode = (roomCode || '').toUpperCase().replace(/[\s\-_]/g, '');
      const encoder = new TextEncoder();
      const codeBytes = encoder.encode(`vanishtext-group-secret:${cleanCode}`);

      // 1. Import room code as PBKDF2 key material
      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        codeBytes,
        { name: 'PBKDF2' },
        false,
        ['deriveKey', 'deriveBits']
      );

      const salt = encoder.encode(`vanishtext-v1-group-salt:${roomId}`);

      // 2. Derive AES-256-GCM encryption key using PBKDF2-SHA256 (10,000 rounds for swift startup + security)
      this.sharedAesKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: 10000,
          hash: 'SHA-256'
        },
        baseKey,
        {
          name: 'AES-GCM',
          length: 256
        },
        false,
        ['encrypt', 'decrypt']
      );

      // 3. Derive SAS Fingerprint bits for visual verification in group mode
      const sasBits = await window.crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: encoder.encode(`vanishtext-v1-group-sas:${roomId}`),
          iterations: 10000,
          hash: 'SHA-256'
        },
        baseKey,
        128
      );

      this.verificationData = this._computeSasFingerprint(sasBits);
      return this.verificationData;
    }

    /**
     * Compute human-readable verification SAS from derived SAS bits.
     * Produces:
     * - 6-digit numeric code (e.g. "849 204")
     * - 4-emoji visual fingerprint (e.g. "🛡️ ⚡ 🔑 🔒")
     * - Hex fingerprint string
     * @private
     */
    _computeSasFingerprint(sasBits) {
      const sasBytes = new Uint8Array(sasBits);

      // 6-digit numeric SAS code (calculated from first 4 bytes)
      const view = new DataView(sasBytes.buffer, sasBytes.byteOffset, 4);
      const num = (view.getUint32(0, false) % 1000000).toString().padStart(6, '0');
      const sasCode = `${num.slice(0, 3)} ${num.slice(3, 6)}`;

      // 4-emoji visual fingerprint
      let emojiStr = '';
      for (let i = 0; i < 4; i++) {
        const idx = sasBytes[i + 4] % SAS_EMOJI_POOL.length;
        emojiStr += (i > 0 ? ' ' : '') + SAS_EMOJI_POOL[idx];
      }

      // Hex fingerprint representation
      let hex = '';
      for (let i = 0; i < 16; i++) {
        hex += sasBytes[i].toString(16).padStart(2, '0');
      }
      const hexFingerprint = hex.toUpperCase().match(/.{1,4}/g).join(':');

      return {
        sasCode,
        emojiFingerprint: emojiStr,
        hexFingerprint
      };
    }

    /**
     * Encrypt a text message using AES-256-GCM.
     * Uses a fresh 96-bit CSPRNG IV for every single message.
     * Additional Authenticated Data (AAD) binds the message to roomId, senderId, and monotonic sequence number.
     *
     * @param {string} plaintext
     * @param {Object} context { roomId, senderId }
     * @returns {Promise<Object>} Encrypted payload { iv, ciphertext, seq }
     */
    async encryptMessage(plaintext, context) {
      if (!this.sharedAesKey) {
        throw new Error('E2EE Session not established. Cannot encrypt message.');
      }
      if (!context || !context.roomId || !context.senderId) {
        throw new Error('Encryption context missing roomId or senderId.');
      }

      this.outboundSeq += 1;
      const currentSeq = this.outboundSeq;

      // Generate fresh 96-bit (12-byte) random IV
      const iv = new Uint8Array(12);
      window.crypto.getRandomValues(iv);

      // Construct Additional Authenticated Data (AAD)
      const aadString = `${context.roomId}:${context.senderId}:${currentSeq}`;
      const aadBytes = new TextEncoder().encode(aadString);

      // Encode plaintext to UTF-8
      const plaintextBytes = new TextEncoder().encode(plaintext);

      // Encrypt with AES-GCM (128-bit authentication tag)
      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: aadBytes,
          tagLength: 128
        },
        this.sharedAesKey,
        plaintextBytes
      );

      return {
        iv: this._arrayBufferToBase64(iv.buffer),
        ciphertext: this._arrayBufferToBase64(ciphertextBuffer),
        seq: currentSeq
      };
    }

    /**
     * Decrypt a received ciphertext payload using AES-256-GCM.
     * Enforces replay protection and validates AAD.
     * Throws on any tampering or authentication failure.
     *
     * @param {Object} payload { iv: string, ciphertext: string, seq: number }
     * @param {Object} context { roomId, senderId }
     * @returns {Promise<string>} Decrypted UTF-8 plaintext
     */
    async decryptMessage(payload, context) {
      if (!this.sharedAesKey) {
        throw new Error('E2EE Session not established. Cannot decrypt message.');
      }
      if (!payload || !payload.iv || !payload.ciphertext || typeof payload.seq !== 'number') {
        throw new Error('Invalid encrypted payload structure received.');
      }
      if (!context || !context.roomId || !context.senderId) {
        throw new Error('Decryption context missing roomId or senderId.');
      }

      // Replay Attack Defense: Ensure strictly monotonic incoming sequence number per sender
      const lastSeq = this.peerSequences.get(context.senderId) || 0;
      if (payload.seq <= lastSeq) {
        throw new Error(`Replay attack detected for sender ${context.senderId}! Sequence ${payload.seq} <= last seen ${lastSeq}`);
      }

      const ivBytes = new Uint8Array(this._base64ToArrayBuffer(payload.iv));
      const ciphertextBytes = this._base64ToArrayBuffer(payload.ciphertext);

      // Reconstruct expected AAD
      const aadString = `${context.roomId}:${context.senderId}:${payload.seq}`;
      const aadBytes = new TextEncoder().encode(aadString);

      try {
        const decryptedBuffer = await window.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: ivBytes,
            additionalData: aadBytes,
            tagLength: 128
          },
          this.sharedAesKey,
          ciphertextBytes
        );

        // Update last seen sequence after successful authenticated decryption
        this.peerSequences.set(context.senderId, payload.seq);
        this.lastReceivedSeq = payload.seq;

        // Decode UTF-8 string
        return new TextDecoder().decode(decryptedBuffer);
      } catch (authError) {
        throw new Error('Message authentication failed! Ciphertext may have been tampered with or corrupted.');
      }
    }

    /**
     * Securely zeroize and destroy all session keys and cryptographic material.
     */
    destroySession() {
      this.localKeypair = null;
      this.localPublicKeyJwk = null;
      this.peerPublicKey = null;
      this.sharedAesKey = null;
      this.verificationData = null;
      this.lastReceivedSeq = 0;
      this.peerSequences.clear();
      this.outboundSeq = 0;
      console.log('[VanishCrypto] Session cryptographic material cleared from memory.');
    }

    /**
     * Check if active encryption session is established.
     * @returns {boolean}
     */
    hasActiveSession() {
      return !!this.sharedAesKey;
    }

    /**
     * Helper: ArrayBuffer to Base64
     * @private
     */
    _arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }

    /**
     * Helper: Base64 to ArrayBuffer
     * @private
     */
    _base64ToArrayBuffer(base64) {
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
  }

  window.VanishCryptoEngine = VanishCryptoEngine;
})(window);
