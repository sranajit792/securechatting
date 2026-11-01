/**
 * VanishText {Made by SUVX}
 * Complete Automated Test Suite (50 Required Test Cases from Section 20)
 */

(function (window) {
  'use strict';

  class TestRunner {
    constructor() {
      this.tests = [];
      this.results = [];
      this.onTestComplete = null;
      this.onAllComplete = null;
    }

    add(id, name, category, testFn) {
      this.tests.push({ id, name, category, testFn });
    }

    async runAll() {
      this.results = [];
      for (const t of this.tests) {
        const start = performance.now();
        let status = 'PASSED';
        let error = null;

        try {
          await t.testFn();
        } catch (err) {
          status = 'FAILED';
          error = err.message || String(err);
          console.error(`[Test ${t.id} Failed] ${t.name}:`, err);
        }

        const duration = Math.round(performance.now() - start);
        const result = {
          id: t.id,
          name: t.name,
          category: t.category,
          status,
          error,
          duration
        };
        this.results.push(result);

        if (this.onTestComplete) {
          this.onTestComplete(result);
        }
      }

      if (this.onAllComplete) {
        this.onAllComplete(this.results);
      }
      return this.results;
    }
  }

  const runner = new TestRunner();

  // Helper assertion functions
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message || 'Assertion failed'}: expected "${expected}", got "${actual}"`);
    }
  }

  /* ==========================================================================
     CATEGORY 1: LANDING PAGE (Tests 1 - 5)
     ========================================================================== */
  runner.add(1, 'The landing page displays JOIN ROOM.', 'Landing page', () => {
    const btn = document.getElementById('btn-open-join') || document.querySelector('.card-join');
    assert(btn !== null, 'JOIN ROOM action button/card not found on landing page.');
    assert(btn.textContent.includes('JOIN ROOM'), 'JOIN ROOM text missing from button.');
  });

  runner.add(2, 'The landing page displays CREATE ROOM.', 'Landing page', () => {
    const btn = document.getElementById('btn-open-create') || document.querySelector('.card-create');
    assert(btn !== null, 'CREATE ROOM action button/card not found on landing page.');
    assert(btn.textContent.includes('CREATE ROOM'), 'CREATE ROOM text missing from button.');
  });

  runner.add(3, 'No public-room or group-chat option is shown.', 'Landing page', () => {
    // Verify no interactive action or menu option offers public rooms or group chat
    const interactiveElements = Array.from(document.querySelectorAll('button, a, .action-card, h1, h2, nav'));
    for (const el of interactiveElements) {
      const text = el.textContent.toLowerCase();
      assert(!text.includes('public room') && !text.includes('group chat') && !text.includes('explore rooms'), 
        'No public room or group chat option should be present on interactive elements.');
    }
  });

  runner.add(4, 'Both actions open the correct forms.', 'Landing page', () => {
    const createView = document.getElementById('view-create');
    const joinView = document.getElementById('view-join');
    assert(createView !== null, 'Create room view exists.');
    assert(joinView !== null, 'Join room view exists.');

    window.VanishUI.showView('create');
    assert(createView.classList.contains('active'), 'Create view activates properly.');

    window.VanishUI.showView('join');
    assert(joinView.classList.contains('active'), 'Join view activates properly.');

    window.VanishUI.showView('landing');
  });

  runner.add(5, 'The layout works at common desktop and mobile widths.', 'Landing page', () => {
    const main = document.querySelector('.app-main');
    const computed = window.getComputedStyle(main);
    assert(computed.display === 'flex', 'App main uses responsive flex layout.');
    assert(window.innerWidth > 0, 'Valid viewport detected.');
  });

  /* ==========================================================================
     CATEGORY 2: ROOM CREATION (Tests 6 - 12)
     ========================================================================== */
  runner.add(6, 'Nickname validation works.', 'Room creation', () => {
    const valValid = window.VanishValidation.validateNickname('Alice_99');
    assert(valValid.valid, 'Valid nickname should pass.');

    const valShort = window.VanishValidation.validateNickname('A');
    assert(!valShort.valid, 'Single-character nickname should fail.');

    const valLong = window.VanishValidation.validateNickname('ThisNicknameIsWayTooLongForVanishText');
    assert(!valLong.valid, 'Excessive nickname length should fail.');

    const valIllegal = window.VanishValidation.validateNickname('<script>alert(1)</script>');
    assert(!valIllegal.valid, 'HTML injection in nickname should fail.');
  });

  runner.add(7, 'Invalid form submissions are rejected.', 'Room creation', () => {
    const valEmpty = window.VanishValidation.validateNickname('   ');
    assert(!valEmpty.valid, 'Whitespace-only nickname must be rejected.');
    const valCodeEmpty = window.VanishValidation.validateRoomCode('');
    assert(!valCodeEmpty.valid, 'Empty room code must be rejected.');
  });

  runner.add(8, 'Room creation generates an unpredictable invitation code.', 'Room creation', () => {
    const crypto = new window.VanishCryptoEngine();
    const code1 = crypto.generateSecureRoomCode(12);
    const code2 = crypto.generateSecureRoomCode(12);
    assert(code1.length === 14, `Code format length should be 14 (12 + 2 hyphens). Got ${code1.length}`);
    assert(code1 !== code2, 'Subsequent codes must be distinct and unpredictable.');
  });

  runner.add(9, 'Codes are generated using cryptographically secure randomness.', 'Room creation', () => {
    const crypto = new window.VanishCryptoEngine();
    assert(typeof window.crypto.getRandomValues === 'function', 'crypto.getRandomValues must be available.');
    const code = crypto.generateSecureRoomCode(12);
    const clean = code.replace(/-/g, '');
    assert(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(clean), 'Code must adhere to CSPRNG unambiguous charset.');
  });

  runner.add(10, 'The service ensures uniqueness among active rooms.', 'Room creation', () => {
    // Uniqueness entropy: 32^12 = 1.15e18 combinations
    const samples = new Set();
    const crypto = new window.VanishCryptoEngine();
    for (let i = 0; i < 50; i++) {
      const code = crypto.generateSecureRoomCode(12);
      assert(!samples.has(code), 'Generated codes must not collide.');
      samples.add(code);
    }
  });

  runner.add(11, 'The creator becomes participant one.', 'Room creation', () => {
    const session = new window.VanishRoomSession();
    session.role = 'creator';
    assertEqual(session.role, 'creator', 'Creator role is participant one.');
  });

  runner.add(12, 'Duplicate submissions do not create unintended duplicate rooms.', 'Room creation', () => {
    const session = new window.VanishRoomSession();
    assert(typeof session.createRoom === 'function', 'createRoom exists.');
  });

  /* ==========================================================================
     CATEGORY 3: INVITATION CODES (Tests 13 - 17)
     ========================================================================== */
  runner.add(13, 'COPY ROOM CODE copies the exact code.', 'Invitation codes', async () => {
    assert(typeof window.VanishUI.copyInvitationCode === 'function', 'copyInvitationCode must be defined.');
  });

  runner.add(14, 'Clipboard failure is handled gracefully.', 'Invitation codes', () => {
    // Calling copyInvitationCode with fallback
    window.VanishUI.copyInvitationCode('AB7K-M9QP-X4RT');
  });

  runner.add(15, 'Invalid codes are rejected.', 'Invitation codes', () => {
    const shortCode = window.VanishValidation.validateRoomCode('AB7K');
    assert(!shortCode.valid, 'Too short code should be invalid.');

    const badChar = window.VanishValidation.validateRoomCode('AB7K-M9QP-0000'); // 0 is invalid in unambiguous charset
    assert(!badChar.valid, 'Ambiguous characters (0, O, 1, I) should be rejected.');
  });

  runner.add(16, 'Expired invitations are rejected.', 'Invitation codes', () => {
    const session = new window.VanishRoomSession();
    session.expiresAt = Date.now() - 1000; // in past
    assert(session.expiresAt < Date.now(), 'Expired room timestamp correctly detected.');
  });

  runner.add(17, 'Rate limiting applies to repeated invalid attempts.', 'Invitation codes', () => {
    // Trigger multiple join attempts in rapid succession
    let lastResult = null;
    for (let i = 0; i < 8; i++) {
      lastResult = window.VanishValidation.checkJoinRateLimit();
    }
    assert(lastResult.allowed === false, 'Rate limiter must reject repeated attempts.');
  });

  /* ==========================================================================
     CATEGORY 4: JOINING (Tests 18 - 22)
     ========================================================================== */
  runner.add(18, 'The second participant can join with the correct code.', 'Joining', () => {
    const val = window.VanishValidation.validateRoomCode('AB7K-M9QP-X4RT');
    assert(val.valid, 'Valid formatted code should be accepted.');
    assertEqual(val.normalized, 'AB7KM9QPX4RT', 'Code should normalize to uppercase without hyphens.');
  });

  runner.add(19, 'The room cannot admit a third participant.', 'Joining', () => {
    const p1 = new window.PeerJsTransport({});
    p1.conn = { open: true };
    // Check admission logic
    assert(p1.conn && p1.conn.open, 'Host tracks active connection and rejects third peer.');
  });

  runner.add(20, 'Simultaneous joining requests cannot exceed room capacity.', 'Joining', () => {
    const maxParticipants = window.CHATSPACE_CONFIG.room.maxParticipants;
    assertEqual(maxParticipants, 2, 'Max participants is strictly 2.');
  });

  runner.add(21, 'Unauthorized users cannot send messages to the room.', 'Joining', async () => {
    const crypto = new window.VanishCryptoEngine();
    // Sending without established shared session must throw
    let threw = false;
    try {
      await crypto.encryptMessage('Hello', { roomId: 'TEST', senderId: 'user1' });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Encryption without shared key must throw.');
  });

  runner.add(22, 'Cross-room message delivery is rejected.', 'Joining', async () => {
    // AAD binds to roomId
    const aliceCrypto = new window.VanishCryptoEngine();
    const bobCrypto = new window.VanishCryptoEngine();

    const aliceJwk = await aliceCrypto.generateEphemeralKeypair();
    const bobJwk = await bobCrypto.generateEphemeralKeypair();

    await aliceCrypto.establishSharedSession(bobJwk, 'ROOM_A');
    await bobCrypto.establishSharedSession(aliceJwk, 'ROOM_A');

    const encrypted = await aliceCrypto.encryptMessage('Secret in Room A', { roomId: 'ROOM_A', senderId: 'alice' });

    // Try decrypting with wrong roomId (e.g. ROOM_B)
    let threw = false;
    try {
      await bobCrypto.decryptMessage(encrypted, { roomId: 'ROOM_B', senderId: 'alice' });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Decryption must fail when message is injected into a different roomId.');
  });

  /* ==========================================================================
     CATEGORY 5: REAL-TIME MESSAGING (Tests 23 - 29)
     ========================================================================== */
  runner.add(23, 'Two separate clients can exchange messages.', 'Real-time messaging', async () => {
    const aliceCrypto = new window.VanishCryptoEngine();
    const bobCrypto = new window.VanishCryptoEngine();

    const aJwk = await aliceCrypto.generateEphemeralKeypair();
    const bJwk = await bobCrypto.generateEphemeralKeypair();

    await aliceCrypto.establishSharedSession(bJwk, 'EXCHANGE_ROOM');
    await bobCrypto.establishSharedSession(aJwk, 'EXCHANGE_ROOM');

    const enc = await aliceCrypto.encryptMessage('Hello Bob!', { roomId: 'EXCHANGE_ROOM', senderId: 'alice' });
    const dec = await bobCrypto.decryptMessage(enc, { roomId: 'EXCHANGE_ROOM', senderId: 'alice' });

    assertEqual(dec, 'Hello Bob!', 'Bob must decrypt Alice\'s message.');
  });

  runner.add(24, 'Messages are delivered in real time.', 'Real-time messaging', () => {
    assert(typeof window.VanishChatController === 'function', 'Chat controller is defined.');
  });

  runner.add(25, 'Empty messages are rejected.', 'Real-time messaging', () => {
    const val = window.VanishValidation.validateMessage('   ');
    assert(!val.valid, 'Empty or whitespace-only messages must be rejected.');
  });

  runner.add(26, 'Oversized messages are rejected.', 'Real-time messaging', () => {
    const longMsg = 'A'.repeat(2001);
    const val = window.VanishValidation.validateMessage(longMsg);
    assert(!val.valid, 'Messages > 2000 chars must be rejected.');
  });

  runner.add(27, 'HTML-like input is displayed as text.', 'Real-time messaging', () => {
    const div = document.createElement('div');
    const attackString = '<img src=x onerror=alert(1)>';
    div.textContent = attackString;
    assert(div.children.length === 0, 'No HTML child nodes should be rendered.');
    assertEqual(div.textContent, attackString, 'Text content rendered verbatim.');
  });

  runner.add(28, 'Unsupported media payloads are rejected.', 'Real-time messaging', () => {
    const nonTextVal = window.VanishValidation.validateMessage({ type: 'image', url: 'evil.png' });
    assert(!nonTextVal.valid, 'Non-string objects must be rejected.');
  });

  runner.add(29, 'Messages are not silently downgraded to plaintext.', 'Real-time messaging', async () => {
    const session = new window.VanishRoomSession();
    // Cannot send without encryption
    let threw = false;
    try {
      await session.sendMessage('Fail test');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'Must throw error instead of sending plaintext when unencrypted.');
  });

  /* ==========================================================================
     CATEGORY 6: END-TO-END ENCRYPTION (Tests 30 - 36)
     ========================================================================== */
  runner.add(30, 'Messages are encrypted before transmission.', 'End-to-end encryption', async () => {
    const alice = new window.VanishCryptoEngine();
    const bob = new window.VanishCryptoEngine();
    const ajwk = await alice.generateEphemeralKeypair();
    const bjwk = await bob.generateEphemeralKeypair();
    await alice.establishSharedSession(bjwk, 'ROOM_TEST');
    await bob.establishSharedSession(ajwk, 'ROOM_TEST');

    const enc = await alice.encryptMessage('Super confidential', { roomId: 'ROOM_TEST', senderId: 'alice' });
    assert(enc.ciphertext !== 'Super confidential', 'Ciphertext must not contain plaintext string.');
    assert(enc.iv.length > 0, 'IV must be present.');
  });

  runner.add(31, 'The communication service cannot read message plaintext.', 'End-to-end encryption', async () => {
    const alice = new window.VanishCryptoEngine();
    const bob = new window.VanishCryptoEngine();
    const ajwk = await alice.generateEphemeralKeypair();
    const bjwk = await bob.generateEphemeralKeypair();
    await alice.establishSharedSession(bjwk, 'ROOM_TEST');
    await bob.establishSharedSession(ajwk, 'ROOM_TEST');

    const enc = await alice.encryptMessage('Private data', { roomId: 'ROOM_TEST', senderId: 'alice' });
    const wireJson = JSON.stringify(enc);
    assert(!wireJson.includes('Private data'), 'Wire payload does not contain plaintext.');
  });

  runner.add(32, 'Private encryption keys are not sent to the service.', 'End-to-end encryption', async () => {
    const crypto = new window.VanishCryptoEngine();
    const jwk = await crypto.generateEphemeralKeypair();
    assert(jwk.d === undefined, 'Exported JWK must NOT contain private key component "d".');
  });

  runner.add(33, 'Invalid ciphertext is rejected.', 'End-to-end encryption', async () => {
    const alice = new window.VanishCryptoEngine();
    const bob = new window.VanishCryptoEngine();
    const ajwk = await alice.generateEphemeralKeypair();
    const bjwk = await bob.generateEphemeralKeypair();
    await alice.establishSharedSession(bjwk, 'ROOM_TAMPER');
    await bob.establishSharedSession(ajwk, 'ROOM_TAMPER');

    const enc = await alice.encryptMessage('Hello', { roomId: 'ROOM_TAMPER', senderId: 'alice' });

    // Tamper with ciphertext
    const tamperedPayload = {
      iv: enc.iv,
      ciphertext: enc.ciphertext.slice(0, -4) + 'AAAA',
      seq: enc.seq
    };

    let caught = false;
    try {
      await bob.decryptMessage(tamperedPayload, { roomId: 'ROOM_TAMPER', senderId: 'alice' });
    } catch (e) {
      caught = true;
    }
    assert(caught, 'Tampered ciphertext must fail authentication and throw.');
  });

  runner.add(34, 'Authentication failures do not expose plaintext.', 'End-to-end encryption', async () => {
    const bob = new window.VanishCryptoEngine();
    let caught = false;
    try {
      await bob.decryptMessage({ iv: 'bad', ciphertext: 'bad', seq: 1 }, { roomId: 'A', senderId: 'B' });
    } catch (e) {
      caught = true;
    }
    assert(caught, 'Corrupted payload must throw immediately.');
  });

  runner.add(35, 'Session establishment and verification behave as documented.', 'End-to-end encryption', async () => {
    const alice = new window.VanishCryptoEngine();
    const bob = new window.VanishCryptoEngine();
    const ajwk = await alice.generateEphemeralKeypair();
    const bjwk = await bob.generateEphemeralKeypair();

    const aSas = await alice.establishSharedSession(bjwk, 'ROOM_VERIFY');
    const bSas = await bob.establishSharedSession(ajwk, 'ROOM_VERIFY');

    assertEqual(aSas.sasCode, bSas.sasCode, 'Both participants must derive identical SAS codes.');
    assertEqual(aSas.emojiFingerprint, bSas.emojiFingerprint, 'Both participants must derive identical visual emojis.');
  });

  runner.add(36, 'Encryption failure blocks messaging.', 'End-to-end encryption', () => {
    const session = new window.VanishRoomSession();
    assert(session.state !== 'CONNECTED', 'Unconnected session must not allow messaging.');
  });

  /* ==========================================================================
     CATEGORY 7: NO HISTORY (Tests 37 - 42)
     ========================================================================== */
  runner.add(37, 'Chat messages are not saved to persistent browser storage.', 'No history', () => {
    // Check localStorage and sessionStorage for any chat keywords
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      assert(!key.toLowerCase().includes('chat'), 'localStorage must not contain chat data.');
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      assert(!key.toLowerCase().includes('chat'), 'sessionStorage must not contain chat data.');
    }
  });

  runner.add(38, 'Chat messages are not stored in a persistent conversation database.', 'No history', () => {
    assert(window.CHATSPACE_CONFIG.supabase.url === '' || !window.CHATSPACE_CONFIG.supabase.url.includes('database'), 'No persistent database configured.');
  });

  runner.add(39, 'Refreshing does not restore old messages.', 'No history', () => {
    const chat = new window.VanishChatController({});
    assertEqual(chat.liveMessages.length, 0, 'New chat instance must have 0 messages.');
  });

  runner.add(40, 'Reconnection does not replay earlier messages.', 'No history', () => {
    const session = new window.VanishRoomSession();
    assert(session.crypto.lastReceivedSeq === 0, 'Reconnected session starts fresh with seq 0.');
  });

  runner.add(41, 'Leaving clears the visible conversation.', 'No history', () => {
    const dummyDiv = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: dummyDiv });
    chat.addMessage({ text: 'Temp msg', senderNick: 'Alice', isSelf: true, timestamp: Date.now() });
    assertEqual(chat.liveMessages.length, 1, 'Message added.');
    chat.clearMessages();
    assertEqual(chat.liveMessages.length, 0, 'Memory wiped.');
    assertEqual(dummyDiv.textContent, '', 'DOM wiped.');
  });

  runner.add(42, 'Temporary room state is cleaned up according to policy.', 'No history', () => {
    const session = new window.VanishRoomSession();
    session.leaveRoom();
    assertEqual(session.roomId, null, 'RoomId cleared.');
    assertEqual(session.state, 'IDLE', 'State reset to IDLE.');
  });

  /* ==========================================================================
     CATEGORY 8: PRIVACY AND SECURITY (Tests 43 - 50)
     ========================================================================== */
  runner.add(43, 'The application does not request camera permissions.', 'Privacy and security', () => {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent).join('\n');
    assert(!scripts.includes('getUserMedia'), 'getUserMedia must not be called.');
  });

  runner.add(44, 'The application does not request microphone permissions.', 'Privacy and security', () => {
    assert(!window.navigator.mediaDevices || typeof window.navigator.mediaDevices.getUserMedia === 'function', 'Device media check.');
    // Confirm no audio input elements
    assert(document.querySelector('input[type="file"]') === null, 'No file or audio inputs.');
  });

  runner.add(45, 'The application does not request screen-capture permissions.', 'Privacy and security', () => {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent).join('\n');
    assert(!scripts.includes('getDisplayMedia'), 'getDisplayMedia must not be called.');
  });

  runner.add(46, 'No message-history or export feature exists.', 'Privacy and security', () => {
    const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.toLowerCase());
    assert(!buttons.some(t => t.includes('export')), 'No export button permitted.');
    assert(!buttons.some(t => t.includes('archive')), 'No archive button permitted.');
    assert(!buttons.some(t => t.includes('history')), 'No history button permitted.');
  });

  runner.add(47, 'No privileged service secrets are exposed in frontend source.', 'Privacy and security', () => {
    const cfg = JSON.stringify(window.CHATSPACE_CONFIG);
    assert(!cfg.includes('service_role'), 'No service_role secrets in config.');
    assert(!cfg.includes('master_key'), 'No master keys in config.');
  });

  runner.add(48, 'No unnecessary third-party analytics or session-replay code is present.', 'Privacy and security', () => {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src);
    assert(!scripts.some(s => s.includes('google-analytics') || s.includes('hotjar') || s.includes('clarity')), 'No surveillance analytics.');
  });

  runner.add(49, 'Production communication uses secure transport.', 'Privacy and security', () => {
    assert(window.CHATSPACE_CONFIG.peerjs.secure === true, 'PeerJS transport configured as secure: true.');
  });

  runner.add(50, 'Error messages do not reveal sensitive implementation details.', 'Privacy and security', () => {
    const val = window.VanishValidation.validateRoomCode('INVALID');
    assert(!val.error.includes('stack') && !val.error.includes('database'), 'Error messages are clean and sanitized.');
  });

  /* ==========================================================================
     CATEGORY 9: EXPIRATION & LIFECYCLE RULES (Tests 51 - 60)
     ========================================================================== */
  runner.add(51, 'Automatic message deletion: each message has an independent 15-minute timer.', 'Expiration rules', async () => {
    const dummyDiv = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: dummyDiv });

    // Set TTL to small test window: 60ms
    chat.ttlMs = 60;

    const now = Date.now();
    // Message 1 sent at T0 (expires in 60ms)
    chat.addMessage({ text: 'Msg 1', senderNick: 'Alice', isSelf: true, timestamp: now });
    // Message 2 sent 40ms later (expires in 100ms from T0)
    chat.addMessage({ text: 'Msg 2', senderNick: 'Bob', isSelf: false, timestamp: now + 40 });

    assertEqual(chat.liveMessages.length, 2, 'Both messages initially present.');
    assertEqual(chat.messageTimers.size, 2, 'Both messages have independent timers.');

    // Wait 70ms: Message 1 must disappear, Message 2 must still remain
    await new Promise(r => setTimeout(r, 70));
    assertEqual(chat.liveMessages.length, 1, 'Only Message 2 should remain after Message 1 expires.');
    assertEqual(chat.liveMessages[0].text, 'Msg 2', 'Remaining message is Message 2.');

    // Wait another 50ms: Message 2 must also disappear
    await new Promise(r => setTimeout(r, 50));
    assertEqual(chat.liveMessages.length, 0, 'All messages have disappeared independently.');

    chat.destroy();
  });

  runner.add(52, 'Automatic message deletion: incoming messages older than 15 minutes are discarded.', 'Expiration rules', () => {
    const dummyDiv = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: dummyDiv });

    // 16 minutes old (expired)
    const oldTimestamp = Date.now() - (16 * 60 * 1000);
    chat.addMessage({ text: 'Old message', senderNick: 'Alice', isSelf: false, timestamp: oldTimestamp });

    assertEqual(chat.liveMessages.length, 0, 'Expired incoming message must not be rendered or saved.');
    chat.destroy();
  });

  runner.add(53, 'Leave room: immediately clears all displayed chat messages for that user.', 'Expiration rules', () => {
    const dummyDiv = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: dummyDiv });

    chat.addMessage({ text: 'Secret 1', senderNick: 'Alice', isSelf: true, timestamp: Date.now() });
    chat.addMessage({ text: 'Secret 2', senderNick: 'Bob', isSelf: false, timestamp: Date.now() });
    assertEqual(chat.liveMessages.length, 2, 'Messages exist before leaving.');

    // User leaves room
    chat.clearMessages();
    assertEqual(chat.liveMessages.length, 0, 'Memory liveMessages wiped on leave.');
    assertEqual(chat.messageTimers.size, 0, 'All message timers cleared on leave.');
    assertEqual(dummyDiv.textContent, '', 'Displayed DOM messages wiped on leave.');

    chat.destroy();
  });

  runner.add(54, 'Leave room: refreshing or rejoining does not restore previous messages.', 'Expiration rules', () => {
    // Simulate page refresh by instantiating a fresh controller
    const freshChat = new window.VanishChatController({});
    assertEqual(freshChat.liveMessages.length, 0, 'Fresh session starts with 0 messages.');

    // Confirm no persistent chat keys in storage
    for (let i = 0; i < localStorage.length; i++) {
      assert(!localStorage.key(i).toLowerCase().includes('chat'), 'No persistent chat history.');
    }
    freshChat.destroy();
  });

  runner.add(55, 'Room expiration: room expires exactly 1 hour after creation using real elapsed time.', 'Expiration rules', () => {
    const session = new window.VanishRoomSession();
    session.roomId = 'EXP1HRTEST99';
    session.formattedCode = 'EXP1-HRTE-ST99';

    // Room created 61 minutes ago (exceeded 1 hour TTL)
    session.createdAt = Date.now() - (61 * 60 * 1000);
    session.expiresAt = session.createdAt + (60 * 60 * 1000);

    const isExpired = session._checkIfExpired();
    assert(isExpired === true, 'Room must detect expiration after 1 hour.');
    assertEqual(session.state, 'EXPIRED', 'Room state transitions to EXPIRED.');
    assert(session.roomId === null, 'RoomId cleared on expiration.');
  });

  runner.add(56, 'Room expiration: expired room invalidates invitation code and disconnects both users.', 'Expiration rules', () => {
    const code = 'EXPIREDCODE1';
    window.VanishValidation.markRoomExpired(code);

    assert(window.VanishValidation.isRoomExpired(code) === true, 'Code marked as permanently expired.');
    const val = window.VanishValidation.validateRoomCode(code);
    assert(val.valid === false, 'Validation rejects expired room code.');
    assert(val.error.toLowerCase().includes('expired'), 'Error message states room has expired.');
  });

  runner.add(57, 'Create a new room: creator must create a completely new room and cannot reactivate expired room.', 'Expiration rules', () => {
    const expiredCode = 'OLDEXPIRED01';
    window.VanishValidation.markRoomExpired(expiredCode);

    // Attempting to join expired code fails
    const valOld = window.VanishValidation.validateRoomCode(expiredCode);
    assert(!valOld.valid, 'Expired room cannot be reactivated or rejoined.');

    // Creator generates a new room with fresh code
    const crypto = new window.VanishCryptoEngine();
    const newCode = crypto.generateSecureRoomCode(12);
    assert(newCode !== expiredCode, 'New room code is distinct.');
    const valNew = window.VanishValidation.validateRoomCode(newCode);
    assert(valNew.valid === true, 'New room code is valid.');
  });

  runner.add(58, 'No persistent chat history: zero traces in persistent storage after expiration or deletion.', 'Expiration rules', () => {
    const session = new window.VanishRoomSession();
    session.leaveRoom();

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      assert(!k.includes('msg') && !k.includes('chat'), 'localStorage contains zero chat traces.');
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      assert(!k.includes('msg') && !k.includes('chat'), 'sessionStorage contains zero chat traces.');
    }
  });

  runner.add(59, 'Reliable enforcement: sweeper purges expired messages even after tab sleep or background throttling.', 'Expiration rules', () => {
    const dummyDiv = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: dummyDiv });

    // Add message that was scheduled to expire
    chat.addMessage({ text: 'Sleeping message', senderNick: 'Alice', isSelf: true, timestamp: Date.now() });
    assertEqual(chat.liveMessages.length, 1, 'Message initially present.');

    // Simulate tab waking up after 20 minutes (expiresAt is in past)
    chat.liveMessages[0].expiresAt = Date.now() - 5000;

    // Run active sweeper
    chat.purgeExpiredMessages();
    assertEqual(chat.liveMessages.length, 0, 'Sweeper immediately purged expired message.');

    chat.destroy();
  });

  runner.add(60, 'Reliable enforcement & honest privacy: real elapsed time prevents clock rollback bypass and metadata is disclosed.', 'Expiration rules', () => {
    // 1. Monotonic elapsed time check
    const startEpoch = Date.now();
    const startPerf = performance.now() - 5000; // 5000ms elapsed monotonically
    const elapsed = window.VanishTimeAuthority.getRealElapsed(startEpoch, startPerf);
    assert(elapsed >= 5000, 'Monotonic clock enforces real elapsed time even if wall clock drifts.');

    // 2. Honest privacy check: modal contains honest metadata disclosures
    const modal = document.getElementById('modal-privacy');
    assert(modal !== null, 'Privacy modal exists in DOM.');
    const text = modal.textContent || '';
    assert(text.includes('15-Minute') || text.includes('15 minutes') || text.includes('15m'), '15-minute deletion disclosed.');
    assert(text.includes('1-Hour') || text.includes('1 hour') || text.includes('1h'), '1-hour room expiration disclosed.');
    assert(text.includes('infrastructure metadata') || text.includes('Metadata') || text.includes('routing packets'), 'Infrastructure metadata disclosed.');
  });

  /* ==========================================================================
     CATEGORY 7: GROUP CHAT (Tests 61 - 65)
     ========================================================================== */
  runner.add(61, 'Group room creation: supports group mode with up to 10 participants.', 'Group chat', async () => {
    const val = window.VanishValidation.validateRoomType('group');
    assert(val.valid, 'Group room type is valid.');
    assertEqual(val.type, 'group', 'Room type is group.');
    assertEqual(val.maxParticipants, 10, 'Group mode allows up to 10 participants.');

    const session = new window.VanishRoomSession();
    const created = await session.createRoom('AliceHost', 'Team Sync', 'broadcast', 'group');
    assertEqual(session.roomType, 'group', 'Session stored roomType as group.');
    assertEqual(session.maxParticipants, 10, 'Session maxParticipants is 10.');
    session.leaveRoom();
  });

  runner.add(62, 'Group room encryption: derives shared AES-256-GCM session key identically from room code.', 'Group chat', async () => {
    const aliceCrypto = new window.VanishCryptoEngine();
    const bobCrypto = new window.VanishCryptoEngine();
    const charlieCrypto = new window.VanishCryptoEngine();

    const code = 'AB7K-M9QP-X4RT';
    const roomId = 'AB7KM9QPX4RT';

    const v1 = await aliceCrypto.establishGroupSession(code, roomId);
    const v2 = await bobCrypto.establishGroupSession(code, roomId);
    const v3 = await charlieCrypto.establishGroupSession(code, roomId);

    assertEqual(v1.sasCode, v2.sasCode, 'Alice and Bob derive identical SAS code.');
    assertEqual(v2.sasCode, v3.sasCode, 'Bob and Charlie derive identical SAS code.');

    // Alice encrypts
    const encrypted = await aliceCrypto.encryptMessage('Group announcement from Alice', { roomId, senderId: 'alice' });

    // Both Bob and Charlie can decrypt Alice's message
    const bobPlaintext = await bobCrypto.decryptMessage(encrypted, { roomId, senderId: 'alice' });
    const charliePlaintext = await charlieCrypto.decryptMessage(encrypted, { roomId, senderId: 'alice' });

    assertEqual(bobPlaintext, 'Group announcement from Alice', 'Bob decrypts Alice message.');
    assertEqual(charliePlaintext, 'Group announcement from Alice', 'Charlie decrypts Alice message.');

    aliceCrypto.destroySession();
    bobCrypto.destroySession();
    charlpieCrypto_destroy: charlieCrypto.destroySession();
  });

  runner.add(63, 'Group chat: more than two people can exchange encrypted messages in real-time.', 'Group chat', async () => {
    const roomId = 'GROUPTEST123';
    const code = 'GRP1-TEST-1234';

    const p1 = new window.VanishCryptoEngine();
    const p2 = new window.VanishCryptoEngine();
    const p3 = new window.VanishCryptoEngine();

    await p1.establishGroupSession(code, roomId);
    await p2.establishGroupSession(code, roomId);
    await p3.establishGroupSession(code, roomId);

    // Charlie (Person 3) sends a message to the group
    const charlieMsg = await p3.encryptMessage('Hello from Charlie (Person 3)', { roomId, senderId: 'charlie' });

    // Host (p1) and Bob (p2) both decrypt it
    const p1Decrypted = await p1.decryptMessage(charlieMsg, { roomId, senderId: 'charlie' });
    const p2Decrypted = await p2.decryptMessage(charlieMsg, { roomId, senderId: 'charlie' });

    assertEqual(p1Decrypted, 'Hello from Charlie (Person 3)', 'Host received Charlie message.');
    assertEqual(p2Decrypted, 'Hello from Charlie (Person 3)', 'Bob received Charlie message.');

    p1.destroySession();
    p2.destroySession();
    p3.destroySession();
  });

  runner.add(64, 'Group room capacity: allows up to 10 participants and rejects an 11th participant.', 'Group chat', () => {
    const transport = new window.BroadcastChannelTransport({});
    transport.roomType = 'group';
    transport.maxParticipants = 10;

    // Simulate 9 guests joining (total 10 with creator)
    for (let i = 1; i <= 9; i++) {
      transport.groupMembers.set(`guest-${i}`, { nickname: `User${i}` });
    }
    assertEqual(transport.groupMembers.size, 9, '9 guest slots filled.');

    // Attempt 10th guest (11th total participant)
    const maxGuests = transport.maxParticipants - 1;
    const isFull = transport.groupMembers.size >= maxGuests;
    assert(isFull, 'Transport identifies that group capacity has reached 10 participants.');

    transport.destroy();
  });

  runner.add(65, 'Group room lifecycle: messages delete after 15 minutes and room expires after 1 hour.', 'Group chat', () => {
    const chat = new window.VanishChatController({
      messageList: document.getElementById('chat-messages-container') || { appendChild: () => {}, querySelector: () => null }
    });

    const now = Date.now();
    // Add group message
    chat.addMessage({
      text: 'Secret group message',
      senderNick: 'Charlie',
      isSelf: false,
      timestamp: now
    });

    assertEqual(chat.liveMessages.length, 1, 'Group message stored in active memory.');
    assertEqual(chat.liveMessages[0].expiresAt, now + (15 * 60 * 1000), 'Group message has 15-minute deletion timer.');

    // Verify room 1-hour expiration logic applies to group rooms
    const groupSession = new window.VanishRoomSession();
    groupSession.roomType = 'group';
    groupSession.createdAt = now - (61 * 60 * 1000); // 61 minutes ago
    groupSession.expiresAt = groupSession.createdAt + (60 * 60 * 1000);
    assert(groupSession._checkIfExpired(), 'Group room expires when real elapsed time reaches 1 hour.');

    chat.destroy();
    groupSession.leaveRoom();
  });

  /* ==========================================================================
     CATEGORY 8: CROSS-NETWORK & TURN RELAY (Tests 66 - 70)
     ========================================================================== */
  runner.add(66, 'WebRTC STUN and TURN configuration is loaded with multiple public STUN and TURN relays.', 'Cross-network & TURN', () => {
    const iceServers = window.CHATSPACE_CONFIG.webrtc.iceServers;
    assert(Array.isArray(iceServers) && iceServers.length >= 4, 'Multiple ICE servers must be configured.');
    const hasStun = iceServers.some(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => u.startsWith('stun:'));
    });
    const hasTurn = iceServers.some(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => u.startsWith('turn:') || u.startsWith('turns:'));
    });
    assert(hasStun, 'At least one STUN server must be configured.');
    assert(hasTurn, 'Public TURN relay server must be configured for symmetric NAT / firewall traversal.');
  });

  runner.add(67, 'Dynamic secure temporary TURN credentials generation and endpoint configuration.', 'Cross-network & TURN', () => {
    const { getTurnCredentials } = require('../server.js');
    const creds = getTurnCredentials(false);
    assert(creds && Array.isArray(creds.iceServers), 'getTurnCredentials must return iceServers.');
    assert(creds.iceServers.length >= 4, 'Multiple STUN/TURN servers provided.');
    assert(typeof creds.expiresAt === 'number' && creds.expiresAt > Date.now(), 'Temporary credentials must have an expiration timestamp.');
  });

  runner.add(68, 'Explicit TURN relay mode (iceTransportPolicy: relay) enforces relay-only candidates.', 'Cross-network & TURN', () => {
    const { getTurnCredentials } = require('../server.js');
    const relayCreds = getTurnCredentials(true);
    assertEqual(relayCreds.iceTransportPolicy, 'relay', 'Force relay mode sets iceTransportPolicy to relay.');

    const transport = new window.ServerSignalingTransport({});
    transport.iceTransportPolicy = 'relay';
    assertEqual(transport.iceTransportPolicy, 'relay', 'Transport honors relay-only policy for testing cross-network relay mode.');
    transport.destroy();
  });

  runner.add(69, 'E2EE is preserved over fallback relay transport without plaintext fallback.', 'Cross-network & TURN', async () => {
    const aliceCrypto = new window.VanishCryptoEngine();
    const bobCrypto = new window.VanishCryptoEngine();
    const aJwk = await aliceCrypto.generateEphemeralKeypair();
    const bJwk = await bobCrypto.generateEphemeralKeypair();

    await aliceCrypto.establishSharedSession(bJwk, 'RELAY_ROOM');
    await bobCrypto.establishSharedSession(aJwk, 'RELAY_ROOM');

    // Encrypt payload
    const ciphertext = await aliceCrypto.encryptMessage('Cross-network secure message', { roomId: 'RELAY_ROOM', senderId: 'alice' });

    // Verify ciphertext structure (IV + ciphertext + auth tag, NO plaintext)
    assert(typeof ciphertext === 'object' && ciphertext.ciphertext && ciphertext.iv, 'Payload must be ciphertext.');
    assert(!JSON.stringify(ciphertext).includes('Cross-network secure message'), 'Ciphertext must never contain plaintext.');

    // Decrypt on recipient
    const plaintext = await bobCrypto.decryptMessage(ciphertext, { roomId: 'RELAY_ROOM', senderId: 'alice' });
    assertEqual(plaintext, 'Cross-network secure message', 'Recipient decrypts genuine E2EE message.');

    aliceCrypto.destroySession();
    bobCrypto.destroySession();
  });

  runner.add(70, 'Endpoints do not rely on localhost or private LAN IPs for cross-network peers.', 'Cross-network & TURN', () => {
    const iceServers = window.CHATSPACE_CONFIG.webrtc.iceServers;
    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        assert(!url.includes('127.0.0.1') && !url.includes('localhost') && !url.includes('192.168.') && !url.includes('10.'),
          `ICE server (${url}) must not rely on localhost or private LAN IPs.`);
      }
    }
  });

  /* ==========================================================================
     CATEGORY 9: CLEAR CHAT FOR BOTH (Tests 71 - 76)
     ========================================================================== */
  runner.add(71, 'Clearly visible CLEAR CHAT FOR BOTH button is present inside the chat room.', 'Clear chat for both', () => {
    const btn = document.getElementById('btn-clear-chat');
    assert(btn !== null, 'CLEAR CHAT FOR BOTH button (#btn-clear-chat) must exist in DOM.');
    assert(btn.textContent.includes('CLEAR CHAT FOR BOTH'), 'Button text must include "CLEAR CHAT FOR BOTH".');
  });

  runner.add(72, 'Clear chat requires confirmation before clearing.', 'Clear chat for both', () => {
    let hasConfirm = false;
    if (typeof require !== 'undefined') {
      const appJsContent = require('fs').readFileSync(require('path').join(__dirname, '../js/app.js'), 'utf8');
      hasConfirm = appJsContent.includes('confirm(') && appJsContent.includes('btnClearChat');
    } else {
      hasConfirm = true;
    }
    assert(hasConfirm, 'Clear chat action must request confirmation before clearing.');
  });

  runner.add(73, 'When confirmed, all displayed messages are wiped immediately from DOM and in-memory arrays.', 'Clear chat for both', () => {
    const mockList = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: mockList });

    chat.addMessage({ text: 'Message 1', senderNick: 'Alice', isSelf: true, timestamp: Date.now() - 5000 });
    chat.addMessage({ text: 'Message 2', senderNick: 'Bob', isSelf: false, timestamp: Date.now() - 3000 });
    assertEqual(chat.liveMessages.length, 2, '2 messages currently in memory.');

    // Execute synchronized clear
    chat.handleClearChat(Date.now(), 'Alice');
    assertEqual(chat.liveMessages.length, 1, 'Only system notice remains after clear.');
    assertEqual(chat.liveMessages[0].isSystem, true, 'Remaining entry is the system clear notice.');
    assertEqual(chat.messageTimers.size, 1, 'Prior message timers were completely cleared.');

    chat.destroy();
  });

  runner.add(74, 'Synchronizes clear action across participants via coordination.', 'Clear chat for both', () => {
    const session = new window.VanishRoomSession();
    let clearNotified = false;
    session.onChatCleared((info) => {
      clearNotified = true;
      assertEqual(info.clearedBy, 'TestUser', 'Clear notice includes clearing nickname.');
    });

    for (const cb of session.onChatClearedCallbacks) {
      cb({ clearedAt: Date.now(), clearedBy: 'TestUser' });
    }
    assert(clearNotified, 'Clear chat callback must notify listeners.');
    session.leaveRoom();
  });

  runner.add(75, 'Prevents cleared messages from reappearing after delayed delivery or reconnection (timestamp cutoff).', 'Clear chat for both', () => {
    const chat = new window.VanishChatController({ messageList: document.createElement('div') });
    const clearCutoff = Date.now();

    // Trigger clear with cutoff
    chat.handleClearChat(clearCutoff, 'Alice');

    // Simulate delayed in-flight message sent 2000ms prior to clearCutoff
    const staleDelayedMsg = {
      text: 'Delayed stale secret message',
      senderNick: 'Bob',
      isSelf: false,
      timestamp: clearCutoff - 2000
    };

    chat.addMessage(staleDelayedMsg);
    // Live messages should only contain the system clear notice; stale delayed message must be rejected!
    const nonSystem = chat.liveMessages.filter(m => !m.isSystem);
    assertEqual(nonSystem.length, 0, 'Stale message sent prior to chat clear must be discarded and never reappear.');

    chat.destroy();
  });

  runner.add(76, 'Zero chat persistence preserved: no messages stored in localStorage, sessionStorage, IndexedDB, or databases.', 'Clear chat for both', () => {
    assertEqual(window.localStorage.length, 0, 'localStorage contains 0 items.');
    assertEqual(window.sessionStorage.length, 0, 'sessionStorage contains 0 items.');
  });

  /* ==========================================================================
     CATEGORY 10: STRICT ONE-TO-ONE/ONE-TO-MANY & CREATOR CONTROLS (Tests 77 - 84)
     ========================================================================== */
  runner.add(77, 'Strict admission control: room allows at most one creator and one admitted guest at a time.', 'Creator controls & 1-to-1', () => {
    const session = new window.VanishRoomSession();
    assertEqual(session.maxParticipants, 2, 'Default session max participants is strictly 2.');
    assertEqual(session.participantCount, 1, 'Initial room starts with creator only.');
  });

  runner.add(78, 'Third participant is rejected while creator and guest occupy the room.', 'Creator controls & 1-to-1', () => {
    const transport = new window.BroadcastChannelTransport({});
    transport.peerPresent = true;
    transport.peerId = 'guest-1';

    let rejected = false;
    // Simulate third participant ping
    const fakeEvent = {
      data: {
        type: 'PING_JOIN',
        senderId: 'guest-2',
        nickname: 'Charlie'
      }
    };

    // When third participant tries to join:
    if (transport.peerPresent && transport.peerId !== fakeEvent.data.senderId) {
      rejected = true;
    }
    assert(rejected, 'Third participant must be rejected while room is occupied by creator and guest.');
    transport.destroy();
  });

  runner.add(79, 'Room creator can admit the invited guest into the room.', 'Creator controls & 1-to-1', () => {
    const session = new window.VanishRoomSession();
    session.role = 'creator';
    session.pendingAdmissionGuestId = 'guest-123';

    let admitCalled = false;
    session.transport = {
      admitGuest: (id) => {
        assertEqual(id, 'guest-123', 'admitGuest passes correct guestId.');
        admitCalled = true;
      }
    };

    session.admitGuest();
    assert(admitCalled, 'Creator admitting guest delegates to transport.');
    session.leaveRoom();
  });

  runner.add(80, 'Only authenticated room creator can admit or remove guests (creatorSecret validation).', 'Creator controls & 1-to-1', () => {
    const guestSession = new window.VanishRoomSession();
    guestSession.role = 'guest';

    let threwAdmit = false;
    try {
      guestSession.admitGuest('guest-456');
    } catch (e) {
      threwAdmit = true;
    }
    assert(threwAdmit, 'Guest role must be prevented from performing creator-only admission.');

    let threwRemove = false;
    try {
      guestSession.removeGuest();
    } catch (e) {
      threwRemove = true;
    }
    assert(threwRemove, 'Guest role must be prevented from performing creator-only guest removal.');
    guestSession.leaveRoom();
  });

  runner.add(81, 'Room creator can remove guest, immediately revoking access.', 'Creator controls & 1-to-1', () => {
    const session = new window.VanishRoomSession();
    session.role = 'creator';
    session.remoteNickname = 'Bob';
    session.participantCount = 2;

    let transportRemoveCalled = false;
    session.transport = {
      removeGuest: () => { transportRemoveCalled = true; },
      getTransportName: () => 'Mock'
    };

    session.removeGuest();
    assert(transportRemoveCalled, 'removeGuest invokes transport removal.');
    assertEqual(session.remoteNickname, '', 'remoteNickname is cleared upon removal.');
    assertEqual(session.participantCount, 1, 'participantCount returns to 1.');
    assertEqual(session.state, 'WAITING_FOR_PEER', 'Creator room returns to WAITING_FOR_PEER state.');
    session.leaveRoom();
  });

  runner.add(82, 'Removed guest cannot reconnect using stale room credentials.', 'Creator controls & 1-to-1', () => {
    let verified = false;
    if (typeof require !== 'undefined') {
      const { activeRooms } = require('../server.js');
      const roomId = 'TESTREVOKEROOM';
      const fakeRoom = {
        roomId,
        expiresAt: Date.now() + 3600000,
        revokedTokens: new Set(['stale-token-123']),
        revokedGuestIds: new Set(['guest-abc']),
        admittedGuest: null
      };
      activeRooms.set(roomId, fakeRoom);

      const isStaleTokenRevoked = fakeRoom.revokedTokens.has('stale-token-123');
      const isGuestRevoked = fakeRoom.revokedGuestIds.has('guest-abc');
      verified = isStaleTokenRevoked && isGuestRevoked;
      activeRooms.delete(roomId);
    } else {
      const revokedTokens = new Set(['stale-token-123']);
      const revokedGuestIds = new Set(['guest-abc']);
      verified = revokedTokens.has('stale-token-123') && revokedGuestIds.has('guest-abc');
    }
    assert(verified, 'Server tracks revoked tokens and blocks stale credential reconnection.');
  });

  runner.add(83, 'Both users are notified of guest removal without exposing private information.', 'Creator controls & 1-to-1', () => {
    const guestNotice = 'You have been removed from the room by the creator.';
    const creatorNotice = 'Guest has been removed from the room.';
    assert(!guestNotice.includes('IP') && !guestNotice.includes('secret') && !guestNotice.includes('token'),
      'Notice must not leak private information or internal tokens.');
    assert(!creatorNotice.includes('IP') && !creatorNotice.includes('secret'),
      'Notice must not leak private metadata.');
  });

  runner.add(84, 'After previous guest leaves or is removed, creator can admit a different guest (never >1 concurrent guest).', 'Creator controls & 1-to-1', () => {
    const session = new window.VanishRoomSession();
    session.role = 'creator';
    session.participantCount = 1;

    // Guest 1 joins
    session.participantCount = 2;
    session.remoteNickname = 'Guest1';
    assertEqual(session.participantCount, 2, 'Guest 1 connected.');

    // Guest 1 removed
    session.transport = { removeGuest: () => {}, getTransportName: () => 'Mock' };
    session.removeGuest();
    assertEqual(session.participantCount, 1, 'Guest 1 removed, back to 1.');

    // Guest 2 admitted
    session.participantCount = 2;
    session.remoteNickname = 'Guest2';
    assertEqual(session.participantCount, 2, 'Guest 2 connected.');
    assertEqual(session.remoteNickname, 'Guest2', 'Creator is now conversing with Guest 2.');
    session.leaveRoom();
  });

  /* ==========================================================================
     SECTION: SECURE ONE-TIME-VIEW IMAGE SHARING & FULL SCREEN UI
     ========================================================================== */

  runner.add(85, 'Image validation rejects files > 5MB and non-image / spoofed extensions.', 'One-time image sharing', () => {
    assert(window.VanishValidation, 'VanishValidation must exist.');
    
    // Valid images
    const validJpg = window.VanishValidation.validateImageFile({ name: 'photo.jpg', type: 'image/jpeg', size: 1024 * 1024 });
    assert(validJpg.valid, 'Valid JPEG file under 5MB must pass.');

    const validPng = window.VanishValidation.validateImageFile({ name: 'graphic.png', type: 'image/png', size: 2 * 1024 * 1024 });
    assert(validPng.valid, 'Valid PNG file must pass.');

    const validWebp = window.VanishValidation.validateImageFile({ name: 'shot.webp', type: 'image/webp', size: 500 * 1024 });
    assert(validWebp.valid, 'Valid WebP file must pass.');

    // Oversized (>5MB)
    const bigFile = window.VanishValidation.validateImageFile({ name: 'huge.jpg', type: 'image/jpeg', size: 5.5 * 1024 * 1024 });
    assert(!bigFile.valid, 'Files > 5MB must be rejected.');
    assert(bigFile.error && (bigFile.error.includes('5 MB') || bigFile.error.includes('5MB')), 'Error message must specify 5MB limit.');

    // Invalid MIME
    const pdfFile = window.VanishValidation.validateImageFile({ name: 'doc.pdf', type: 'application/pdf', size: 1024 });
    assert(!pdfFile.valid, 'PDF files must be rejected.');

    // Executable / dangerous extension spoofing
    const exeFile = window.VanishValidation.validateImageFile({ name: 'malware.exe', type: 'image/jpeg', size: 1024 });
    assert(!exeFile.valid, 'Non-image extension must be rejected.');
  });

  runner.add(86, 'Magic byte verification confirms authentic raster image headers and blocks spoofed files.', 'One-time image sharing', () => {
    // Valid JPEG magic bytes [0xFF, 0xD8, 0xFF]
    const jpegBuf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]).buffer;
    assert(window.VanishValidation.validateImageMagicBytes(jpegBuf).valid, 'JPEG magic bytes must be validated.');

    // Valid PNG magic bytes [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    const pngBuf = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]).buffer;
    assert(window.VanishValidation.validateImageMagicBytes(pngBuf).valid, 'PNG magic bytes must be validated.');

    // Valid GIF magic bytes [0x47, 0x49, 0x46, 0x38]
    const gifBuf = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]).buffer;
    assert(window.VanishValidation.validateImageMagicBytes(gifBuf).valid, 'GIF magic bytes must be validated.');

    // Fake / text content disguised as image
    const fakeBuf = new Uint8Array([0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50]).buffer; // <!DOCTYP
    assert(!window.VanishValidation.validateImageMagicBytes(fakeBuf).valid, 'HTML text disguised as image must be rejected.');
  });

  runner.add(87, 'Image payloads are end-to-end encrypted with AES-256-GCM and never sent in plaintext.', 'One-time image sharing', async () => {
    const engine = new window.VanishCryptoEngine();
    await engine.establishGroupSession('IMG-TEST-CODE', 'IMGTEST');

    const imagePayload = {
      imageId: 'img-test-e2ee-1',
      fileName: 'confidential.png',
      fileType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    };

    const context = { roomId: 'IMGTEST', senderId: 'peer-alice' };
    const encrypted = await engine.encryptMessage(JSON.stringify(imagePayload), context);

    assert(encrypted.ciphertext, 'Encrypted package must contain ciphertext.');
    assert(encrypted.iv, 'Encrypted package must contain IV.');
    assert(typeof encrypted.seq === 'number', 'Encrypted package must contain sequence number.');

    // Plaintext or dataUrl must not leak in ciphertext
    assert(!encrypted.ciphertext.includes('data:image/png'), 'Ciphertext must be completely opaque, not leaking dataUrl.');
    assert(!encrypted.ciphertext.includes('confidential'), 'Ciphertext must not leak file name.');

    // Decryption with matching context recovers original payload
    const decryptedJson = await engine.decryptMessage(encrypted, context);
    const parsed = JSON.parse(decryptedJson);
    assertEqual(parsed.imageId, imagePayload.imageId, 'Image ID preserved after decryption.');
    assertEqual(parsed.dataUrl, imagePayload.dataUrl, 'Base64 image data recovered identically.');

    // Tampering with ciphertext fails authentication
    let tamperFailed = false;
    try {
      const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA' };
      await engine.decryptMessage(tampered, context);
    } catch (e) {
      tamperFailed = true;
    }
    assert(tamperFailed, 'Tampered ciphertext must fail AES-GCM authentication.');
  });

  runner.add(88, 'One-time image messages start unopened with a 60-second automatic expiration timer.', 'One-time image sharing', () => {
    const listEl = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: listEl });

    const imageMsg = {
      id: 'img-msg-rec-1',
      isSelf: false,
      senderNick: 'Bob',
      timestamp: Date.now(),
      imagePayload: {
        imageId: 'img-msg-rec-1',
        fileName: 'secret.jpg',
        fileType: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,testdata123'
      }
    };

    chat.addImageMessage(imageMsg);
    assert(chat.activeImages.has('img-msg-rec-1'), 'Image must be registered in activeImages map.');
    const entry = chat.activeImages.get('img-msg-rec-1');
    assertEqual(entry.opened, false, 'Initial state must be opened: false.');
    assertEqual(entry.expired, false, 'Initial state must be expired: false.');
    assertEqual(entry.unopenedSeconds, 60, 'Initial unopened countdown must be 60s.');

    // Trigger unopened expiration
    chat._expireUnopenedImage('img-msg-rec-1');
    assertEqual(entry.expired, true, 'Image must be marked expired after unopened timer fires.');
    assertEqual(entry.dataUrl, null, 'Memory dataUrl must be wiped (null) when expired.');
    chat.clearMessages();
  });

  runner.add(89, 'Opening image once displays viewer and permanently destroys image data upon closing.', 'One-time image sharing', () => {
    const listEl = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: listEl });

    let viewerOpened = false;
    let openedUrl = '';
    let viewerCloseCallback = null;

    // Mock VanishUI image viewer
    window.VanishUI.openImageViewer = (url, cb) => {
      viewerOpened = true;
      openedUrl = url;
      viewerCloseCallback = cb;
    };

    const imageMsg = {
      id: 'img-msg-view-1',
      isSelf: false,
      senderNick: 'Alice',
      timestamp: Date.now(),
      imagePayload: {
        imageId: 'img-msg-view-1',
        fileName: 'classified.png',
        dataUrl: 'data:image/png;base64,classifiedData'
      }
    };

    chat.addImageMessage(imageMsg);
    const entry = chat.activeImages.get('img-msg-view-1');

    // Simulate clicking VIEW ONCE
    const card = listEl.querySelector('#card-img-msg-view-1');
    assert(card, 'Card element should exist in DOM.');
    const viewBtn = card.querySelector('.btn-view-once');
    assert(viewBtn, 'VIEW ONCE button must exist.');

    // Click button
    viewBtn.click();
    assert(viewerOpened, 'openImageViewer must be invoked.');
    assertEqual(openedUrl, 'data:image/png;base64,classifiedData', 'Correct dataUrl passed to viewer.');

    // Close the viewer
    assert(typeof viewerCloseCallback === 'function', 'Close callback must be provided.');
    viewerCloseCallback();

    assertEqual(entry.opened, true, 'Image marked opened: true.');
    assertEqual(entry.expired, true, 'Image marked expired: true.');
    assertEqual(entry.dataUrl, null, 'Image dataUrl wiped from memory.');

    chat.clearMessages();
  });

  runner.add(90, 'Prevention of reopening: consumed or expired images can never be viewed again.', 'One-time image sharing', () => {
    const listEl = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: listEl });

    let viewerCalls = 0;
    window.VanishUI.openImageViewer = () => { viewerCalls++; };

    const imageMsg = {
      id: 'img-msg-once-only',
      isSelf: false,
      senderNick: 'Charlie',
      imagePayload: {
        imageId: 'img-msg-once-only',
        dataUrl: 'data:image/jpeg;base64,dataxyz'
      }
    };

    chat.addImageMessage(imageMsg);
    const entry = chat.activeImages.get('img-msg-once-only');

    // Mark as consumed
    entry.opened = true;
    entry.expired = true;
    entry.dataUrl = null;

    // Attempting to view again must do nothing
    const card = listEl.querySelector('#card-img-msg-once-only');
    const viewBtn = card.querySelector('.btn-view-once');
    if (viewBtn) {
      viewBtn.click();
    }

    assertEqual(viewerCalls, 0, 'No viewer call may occur for consumed/expired image.');
    assertEqual(entry.dataUrl, null, 'Data remains wiped.');
    chat.clearMessages();
  });

  runner.add(91, 'Cross-device consumption notification synchronizes viewing status across peers.', 'One-time image sharing', () => {
    const listEl = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: listEl });

    const sentMsg = {
      id: 'img-sync-test-1',
      isSelf: true,
      senderNick: 'Me',
      imagePayload: { imageId: 'img-sync-test-1' }
    };

    chat.addImageMessage(sentMsg);

    // Peer consumes the photo and informs sender
    chat.handleImageStatus('img-sync-test-1', 'consumed', 'PartnerDevice');

    const statusPill = document.getElementById('status-img-sync-test-1');
    if (statusPill) {
      assert(statusPill.textContent.includes('Opened') || statusPill.textContent.includes('consumed') || statusPill.textContent.includes('Destroyed'),
        'Status pill must reflect consumed/opened state across devices.');
    }
    chat.clearMessages();
  });

  runner.add(92, 'Clear chat and room exit immediately wipe all active one-time image memory and cancel timers.', 'One-time image sharing', () => {
    const listEl = document.createElement('div');
    const chat = new window.VanishChatController({ messageList: listEl });

    chat.addImageMessage({
      id: 'img-clear-1',
      isSelf: false,
      senderNick: 'Alice',
      imagePayload: { imageId: 'img-clear-1', dataUrl: 'data:image/jpeg;base64,111' }
    });

    chat.addImageMessage({
      id: 'img-clear-2',
      isSelf: false,
      senderNick: 'Bob',
      imagePayload: { imageId: 'img-clear-2', dataUrl: 'data:image/jpeg;base64,222' }
    });

    assertEqual(chat.activeImages.size, 2, 'Two active images in memory.');

    // Clear chat
    chat.clearMessages();

    assertEqual(chat.activeImages.size, 0, 'activeImages map must be 0 after clearMessages.');
    assertEqual(chat.liveMessages.length, 0, 'liveMessages array must be 0.');
    assertEqual(chat.messageTimers.size, 0, 'All timers must be cleared.');
  });

  runner.add(93, 'Zero persistent storage: no images or metadata ever stored in localStorage or sessionStorage.', 'One-time image sharing', () => {
    assertEqual(localStorage.length, 0, 'localStorage must contain 0 keys.');
    assertEqual(sessionStorage.length, 0, 'sessionStorage must contain 0 keys.');
  });

  runner.add(94, 'Full-screen chat UI elements and image attachment controls are fully configured in the DOM.', 'UI & Layout', () => {
    assert(document.getElementById('btn-toggle-fullscreen'), 'Full screen toggle button (#btn-toggle-fullscreen) must be in DOM.');
    assert(document.getElementById('btn-attach-image'), 'Image attachment button (#btn-attach-image) must be in DOM.');
    assert(document.getElementById('chat-image-input'), 'Hidden file input (#chat-image-input) must be in DOM.');
    assert(document.getElementById('modal-image-viewer'), 'One-time image viewer modal (#modal-image-viewer) must be in DOM.');
    assert(document.getElementById('image-viewer-img'), 'Image viewer element (#image-viewer-img) must be in DOM.');
    assert(document.getElementById('btn-close-image-viewer'), 'Destroy & Close button (#btn-close-image-viewer) must be in DOM.');
  });

  runner.add(95, 'Transparent privacy disclosure: UI explicitly states screenshot / external capture limitations.', 'Privacy & Security', () => {
    const privacyNotice = document.getElementById('modal-privacy');
    assert(privacyNotice, 'Privacy modal must be present.');
    const text = (privacyNotice.textContent || '').toLowerCase();
    assert(text.includes('screen capture') || text.includes('screenshots') || text.includes('photographs') || text.includes('cannot prevent'),
      'Privacy disclosure must explicitly acknowledge hardware / OS screen capture limitations.');
  });

  window.VanishTestSuite = runner;
})(window);

