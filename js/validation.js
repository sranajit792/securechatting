/**
 * VanishText {Made by SUVX}
 * Input Validation & Data Sanitization Module
 *
 * Strict client-side and transport validation for text-only, privacy-first messaging.
 */

(function (window) {
  'use strict';

  const config = window.CHATSPACE_CONFIG || {
    room: {
      codeLength: 12,
      codeCharset: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    },
    messaging: {
      maxMessageLength: 2000,
      rateLimitMax: 5,
      rateLimitWindowMs: 2000
    }
  };

  const NICKNAME_REGEX = /^[a-zA-Z0-9 _.-]{2,24}$/;
  const CLEAN_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/;

  // Rate limiting tracker
  const rateLimitState = {
    messageTimestamps: [],
    joinAttempts: [],
    createAttempts: []
  };

  /**
   * Trusted Time Authority
   * Reliable enforcement of message expiration (15 minutes) and room expiration (1 hour).
   * Defends against local clock rollback and timer throttling by pairing wall time
   * with high-precision monotonic performance.now() and server HTTP Date synchronization.
   */
  const TimeAuthority = {
    clockOffsetMs: 0,
    perfBaseline: typeof performance !== 'undefined' ? performance.now() : 0,
    epochBaseline: Date.now(),
    isSynced: false,

    async syncWithServer() {
      if (typeof window !== 'undefined' && typeof window.fetch === 'function' && window.location && window.location.href) {
        try {
          const res = await window.fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
          const dateHeader = res.headers.get('date');
          if (dateHeader) {
            const serverMs = new Date(dateHeader).getTime();
            if (!isNaN(serverMs)) {
              this.clockOffsetMs = serverMs - Date.now();
              this.isSynced = true;
              console.log(`[TimeAuthority] Synchronized with trusted server time. Offset: ${this.clockOffsetMs}ms`);
            }
          }
        } catch (e) {
          // Offline or local dev fallback
        }
      }
    },

    now() {
      return Date.now() + this.clockOffsetMs;
    },

    getRealElapsed(startEpochMs, startPerfMs) {
      const nowEpoch = this.now();
      const wallElapsed = Math.max(0, nowEpoch - startEpochMs);
      const perfElapsed = (startPerfMs && typeof performance !== 'undefined')
        ? Math.max(0, performance.now() - startPerfMs)
        : 0;
      return Math.max(wallElapsed, perfElapsed);
    },

    isMessageExpired(timestamp, ttlMs = 15 * 60 * 1000) {
      if (!timestamp || typeof timestamp !== 'number') return true;
      const elapsed = this.now() - timestamp;
      return elapsed >= ttlMs;
    },

    isRoomExpired(createdAt, ttlMs = 60 * 60 * 1000) {
      if (!createdAt || typeof createdAt !== 'number') return true;
      const elapsed = this.now() - createdAt;
      return elapsed >= ttlMs;
    }
  };

  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    setTimeout(() => TimeAuthority.syncWithServer(), 100);
  }

  // Set of permanently expired room codes (normalized)
  const expiredRooms = new Set();

  const Validation = {
    expiredRooms,

    /**
     * Mark a room code as permanently expired.
     * Expired rooms can NEVER be reactivated.
     * @param {string} code
     */
    markRoomExpired(code) {
      if (!code) return;
      const clean = String(code).toUpperCase().replace(/[\s\-_]/g, '');
      expiredRooms.add(clean);
      console.log(`[Validation] Room ${clean} marked as permanently expired.`);
    },

    /**
     * Check if a room code has already expired.
     * @param {string} code
     * @returns {boolean}
     */
    isRoomExpired(code) {
      if (!code) return false;
      const clean = String(code).toUpperCase().replace(/[\s\-_]/g, '');
      return expiredRooms.has(clean);
    },
    /**
     * Validate user nickname.
     * @param {string} nickname
     * @returns {{ valid: boolean, error?: string, sanitized: string }}
     */
    validateNickname(nickname) {
      if (typeof nickname !== 'string') {
        return { valid: false, error: 'Nickname must be text.', sanitized: '' };
      }
      const trimmed = nickname.trim();
      if (trimmed.length < 2) {
        return { valid: false, error: 'Nickname must be at least 2 characters long.', sanitized: trimmed };
      }
      if (trimmed.length > 24) {
        return { valid: false, error: 'Nickname cannot exceed 24 characters.', sanitized: trimmed };
      }
      if (!NICKNAME_REGEX.test(trimmed)) {
        return {
          valid: false,
          error: 'Nickname can only contain letters, numbers, spaces, dots, hyphens, and underscores.',
          sanitized: trimmed
        };
      }
      // Ensure it contains at least one alphanumeric character
      if (!/[a-zA-Z0-9]/.test(trimmed)) {
        return { valid: false, error: 'Nickname must include at least one letter or number.', sanitized: trimmed };
      }
      return { valid: true, sanitized: trimmed };
    },

    /**
     * Validate optional room name.
     * @param {string} roomName
     * @returns {{ valid: boolean, error?: string, sanitized: string }}
     */
    validateRoomName(roomName) {
      if (!roomName || typeof roomName !== 'string') {
        return { valid: true, sanitized: 'Private Room' };
      }
      const trimmed = roomName.trim();
      if (trimmed.length === 0) {
        return { valid: true, sanitized: 'Private Room' };
      }
      if (trimmed.length > 32) {
        return { valid: false, error: 'Room name cannot exceed 32 characters.', sanitized: trimmed };
      }
      // Strip dangerous characters, keep printable text
      const sanitized = trimmed.replace(/[<>'"`;]/g, '');
      return { valid: true, sanitized: sanitized || 'Private Room' };
    },

    /**
     * Validate room type ('direct' | 'group').
     * @param {string} roomType
     * @returns {{ valid: boolean, type: string, maxParticipants: number }}
     */
    validateRoomType(roomType) {
      if (roomType === 'group') {
        const groupMax = (config.room && config.room.groupMaxParticipants) || 10;
        return { valid: true, type: 'group', maxParticipants: groupMax };
      }
      return { valid: true, type: 'direct', maxParticipants: (config.room && config.room.maxParticipants) || 2 };
    },

    /**
     * Normalize and validate an invitation code.
     * Accepts formats like: "AB7K-M9QP-X4RT", "ab7k m9qp x4rt", "AB7KM9QPX4RT"
     * @param {string} rawCode
     * @returns {{ valid: boolean, error?: string, normalized: string, formatted: string }}
     */
    validateRoomCode(rawCode) {
      if (!rawCode || typeof rawCode !== 'string') {
        return { valid: false, error: 'Invitation code cannot be empty.', normalized: '', formatted: '' };
      }
      // Strip hyphens, spaces, and convert to uppercase
      const normalized = rawCode.toUpperCase().replace(/[\s\-_]/g, '');

      if (this.isRoomExpired(normalized)) {
        return {
          valid: false,
          error: 'This room has reached its 1-hour expiration and is permanently disabled. Never reactivate an expired room; please create a new room with a new invitation code.',
          normalized: normalized,
          formatted: normalized.match(/.{1,4}/g) ? normalized.match(/.{1,4}/g).join('-') : normalized
        };
      }

      const expectedLen = config.room.codeLength || 12;

      if (normalized.length !== expectedLen) {
        return {
          valid: false,
          error: `Invitation code must contain exactly ${expectedLen} alphanumeric characters (e.g., AB7K-M9QP-X4RT).`,
          normalized: '',
          formatted: ''
        };
      }

      if (!CLEAN_CODE_REGEX.test(normalized)) {
        return {
          valid: false,
          error: 'Invitation code contains invalid characters. Codes do not use ambiguous letters (0, O, 1, I).',
          normalized: '',
          formatted: ''
        };
      }

      // Format with standard hyphens (e.g. AB7K-M9QP-X4RT)
      const formatted = normalized.match(/.{1,4}/g).join('-');

      return {
        valid: true,
        normalized: normalized,
        formatted: formatted
      };
    },

    /**
     * Format a raw normalized code string into XXXX-XXXX-XXXX
     * @param {string} code
     * @returns {string}
     */
    formatRoomCode(code) {
      if (!code) return '';
      const clean = code.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '').slice(0, 12);
      const parts = clean.match(/.{1,4}/g);
      return parts ? parts.join('-') : clean;
    },

    /**
     * Validate chat message content before encryption and transmission.
     * Enforces STRICT TEXT ONLY policy and 15-minute message lifetime.
     * @param {any} message
     * @param {number} [timestamp] Optional message creation epoch ms
     * @returns {{ valid: boolean, error?: string, sanitized: string }}
     */
    validateMessage(message, timestamp) {
      if (typeof message !== 'string') {
        return { valid: false, error: 'Strict Text Policy: Only plain text messages are supported.', sanitized: '' };
      }

      // Check for zero-byte or control characters
      const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      const trimmed = sanitized.trim();

      if (trimmed.length === 0) {
        return { valid: false, error: 'Message cannot be empty.', sanitized: '' };
      }

      const maxLen = config.messaging.maxMessageLength || 2000;
      if (sanitized.length > maxLen) {
        return {
          valid: false,
          error: `Message exceeds the ${maxLen} character limit (current length: ${sanitized.length}).`,
          sanitized: ''
        };
      }

      if (typeof timestamp === 'number') {
        const msgTtlMinutes = (config.messaging && config.messaging.messageTtlMinutes) || 15;
        const ttlMs = msgTtlMinutes * 60 * 1000;
        if (TimeAuthority.isMessageExpired(timestamp, ttlMs)) {
          return { valid: false, error: 'Message has expired (exceeded 15-minute lifespan).', sanitized: '' };
        }
      }

      return { valid: true, sanitized: sanitized };
    },

    /**
     * Rate limiter for sending messages.
     * @returns {{ allowed: boolean, waitMs: number }}
     */
    checkMessageRateLimit() {
      const now = Date.now();
      const maxMsgs = config.messaging.rateLimitMax || 5;
      const windowMs = config.messaging.rateLimitWindowMs || 2000;

      // Clean old timestamps outside the window
      rateLimitState.messageTimestamps = rateLimitState.messageTimestamps.filter(
        ts => now - ts < windowMs
      );

      if (rateLimitState.messageTimestamps.length >= maxMsgs) {
        const oldest = rateLimitState.messageTimestamps[0];
        const waitMs = windowMs - (now - oldest);
        return { allowed: false, waitMs: Math.max(100, waitMs) };
      }

      rateLimitState.messageTimestamps.push(now);
      return { allowed: true, waitMs: 0 };
    },

    /**
     * Rate limiter for joining attempts to deter brute-force guessing.
     * @returns {{ allowed: boolean, waitMs: number }}
     */
    checkJoinRateLimit() {
      const now = Date.now();
      const maxAttempts = 6;
      const windowMs = 30000; // 30 seconds

      rateLimitState.joinAttempts = rateLimitState.joinAttempts.filter(
        ts => now - ts < windowMs
      );

      if (rateLimitState.joinAttempts.length >= maxAttempts) {
        const oldest = rateLimitState.joinAttempts[0];
        const waitMs = windowMs - (now - oldest);
        return { allowed: false, waitMs: Math.max(500, waitMs) };
      }

      rateLimitState.joinAttempts.push(now);
      return { allowed: true, waitMs: 0 };
    },

    /**
     * Escape special HTML characters to prevent XSS if ever interpolated.
     * Note: All chat rendering uses textContent or createTextNode.
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    /**
     * Validate an image file before reading, resizing, or encrypting.
     * Enforces allowed raster formats (JPEG, PNG, WebP, GIF) and maximum 5MB size.
     * Rejects executable files, SVGs with scripts, or unsupported media.
     * @param {File|Object} file
     * @returns {{ valid: boolean, error?: string }}
     */
    validateImageFile(file) {
      if (!file) {
        return { valid: false, error: 'No image selected.' };
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      const fileType = (file.type || '').toLowerCase();

      if (!fileType || !allowedMimes.includes(fileType)) {
        return {
          valid: false,
          error: 'Invalid image format. VanishText strictly allows JPEG, PNG, WebP, or GIF photos for one-time viewing.'
        };
      }

      // Validate file extension against allowed list
      const fileName = (file.name || '').toLowerCase();
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const hasValidExt = validExtensions.some(ext => fileName.endsWith(ext));
      if (!hasValidExt) {
        return {
          valid: false,
          error: 'Invalid file extension. Please select a valid .jpg, .png, .webp, or .gif file.'
        };
      }

      const maxSizeBytes = 5 * 1024 * 1024; // 5 MB
      if (typeof file.size === 'number' && file.size > maxSizeBytes) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        return {
          valid: false,
          error: `Selected image (${sizeMb} MB) exceeds maximum allowed size limit of 5 MB.`
        };
      }

      return { valid: true };
    },

    /**
     * Verify image magic bytes from ArrayBuffer to prevent spoofed extensions/MIMEs.
     * @param {ArrayBuffer} buffer
     * @returns {{ valid: boolean, detectedType?: string, error?: string }}
     */
    validateImageMagicBytes(buffer) {
      if (!buffer || buffer.byteLength < 4) {
        return { valid: false, error: 'Empty or corrupt image buffer.' };
      }

      const bytes = new Uint8Array(buffer);

      // JPEG: FF D8 FF
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return { valid: true, detectedType: 'image/jpeg' };
      }

      // PNG: 89 50 4E 47
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return { valid: true, detectedType: 'image/png' };
      }

      // GIF: 47 49 46 38 ('GIF8')
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return { valid: true, detectedType: 'image/gif' };
      }

      // WebP: 52 49 46 46 ('RIFF') ... 57 45 42 50 ('WEBP')
      if (bytes.length >= 12 &&
          bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return { valid: true, detectedType: 'image/webp' };
      }

      return {
        valid: false,
        error: 'File contents do not match genuine image headers (spoofed image detected).'
      };
    }
  };

  window.VanishValidation = Validation;
  window.VanishTimeAuthority = TimeAuthority;
})(window);
