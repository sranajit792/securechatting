/**
 * VanishText {Made by SUVX}
 * Complete End-to-End Network, WebRTC STUN/TURN, and Coordination Integration Test
 */

const http = require('http');
const WebSocket = require('ws');
const { server, activeRooms, getTurnCredentials } = require('../server.js');
const { webcrypto } = require('crypto');

// WebCrypto polyfill for Node.js test environment
global.crypto = webcrypto;

const TEST_PORT = 8089;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error('Assertion failed: ' + msg);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

async function runIntegrationTests() {
  console.log('===============================================================');
  console.log('    VANISHTEXT — END-TO-END NETWORK & SERVER INTEGRATION SUITE  ');
  console.log('===============================================================');

  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server] Listening on http://localhost:${TEST_PORT}`);

  try {
    // ------------------------------------------------------------------------
    // TEST 1: TURN CREDENTIALS & RELAY CONFIGURATION
    // ------------------------------------------------------------------------
    console.log('\n--- Test 1: WebRTC STUN/TURN Relay Endpoint ---');
    const credsRes = await fetch(`http://localhost:${TEST_PORT}/api/turn-credentials?mode=relay`);
    assertEqual(credsRes.status, 200, 'TURN endpoint returns 200 OK');
    const creds = await credsRes.json();
    assert(Array.isArray(creds.iceServers) && creds.iceServers.length >= 4, 'Multiple STUN/TURN servers provided');
    assertEqual(creds.iceTransportPolicy, 'relay', 'Explicit relay mode policy is honored');

    const hasTurn443 = creds.iceServers.some(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => u.includes('turn:') && u.includes(':443'));
    });
    const hasTurnsTls = creds.iceServers.some(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => u.includes('turns:'));
    });
    assert(hasTurn443, 'Port 443 TURN relay available for corporate firewall / cellular traversal');
    assert(hasTurnsTls, 'TLS TURNS over TCP port 443 available for restrictive VPNs');
    console.log('  [PASS] TURN credentials endpoint and relay configurations verified.');

    // ------------------------------------------------------------------------
    // TEST 2: ROOM CREATION & CREATOR TOKEN GENERATION
    // ------------------------------------------------------------------------
    console.log('\n--- Test 2: Room Creation & Creator Authentication ---');
    const roomId = 'NETTEST12345';
    const aliceWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);

    let aliceSecret = null;
    let aliceReady = new Promise((resolve) => {
      aliceWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ROOM_CREATED') {
          aliceSecret = msg.creatorSecret;
          assert(aliceSecret && aliceSecret.length >= 32, 'Unguessable CSPRNG creatorSecret generated');
          resolve(msg);
        }
      });
    });

    await new Promise(r => aliceWs.on('open', r));
    aliceWs.send(JSON.stringify({
      type: 'CREATE_ROOM',
      roomId: roomId,
      nickname: 'Alice',
      jwk: { kty: 'EC', crv: 'P-256', x: 'mockAliceX', y: 'mockAliceY' }
    }));

    await aliceReady;
    console.log('  [PASS] Room created on server with unguessable creatorSecret.');

    // ------------------------------------------------------------------------
    // TEST 3: GUEST ADMISSION REQUEST & CREATOR CONTROL
    // ------------------------------------------------------------------------
    console.log('\n--- Test 3: Guest Admission Request & Creator Approval ---');
    const bobWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    await new Promise(r => bobWs.on('open', r));

    let bobGuestId = null;
    let bobAdmitted = false;
    let bobAdmissionWait = new Promise((resolve) => {
      bobWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'WAITING_FOR_ADMISSION') {
          bobGuestId = msg.guestId;
        } else if (msg.type === 'ADMISSION_GRANTED') {
          bobAdmitted = true;
          assert(msg.guestToken && msg.guestToken.length >= 32, 'Ephemeral guestToken issued');
          bobWs.guestToken = msg.guestToken;
          resolve();
        }
      });
    });

    let creatorAdmissionRequestReceived = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ADMISSION_REQUEST') {
          aliceWs.off('message', handler);
          assertEqual(msg.nickname, 'Bob', 'Creator sees Bob requesting to join');
          resolve(msg);
        }
      };
      aliceWs.on('message', handler);
    });

    // Bob requests admission
    bobWs.send(JSON.stringify({
      type: 'REQUEST_ADMISSION',
      roomId: roomId,
      nickname: 'Bob',
      jwk: { kty: 'EC', crv: 'P-256', x: 'mockBobX', y: 'mockBobY' }
    }));

    const reqMsg = await creatorAdmissionRequestReceived;
    assert(reqMsg.guestId, 'Admission request includes unique guestId');

    // Alice approves Bob's admission using creatorSecret
    aliceWs.send(JSON.stringify({
      type: 'ADMIT_GUEST',
      roomId: roomId,
      guestId: reqMsg.guestId,
      creatorSecret: aliceSecret
    }));

    await bobAdmissionWait;
    assert(bobAdmitted, 'Bob received ADMISSION_GRANTED');
    console.log('  [PASS] Guest admission flow verified.');

    // ------------------------------------------------------------------------
    // TEST 4: STRICT 1-TO-1 ADMISSION CONTROL: REJECT THIRD PARTICIPANT
    // ------------------------------------------------------------------------
    console.log('\n--- Test 4: Rejection of Third Participant While Room Occupied ---');
    const charlieWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    await new Promise(r => charlieWs.on('open', r));

    let charlieRejected = new Promise((resolve) => {
      charlieWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ROOM_FULL') {
          assertEqual(msg.message, 'This room is full. Only two participants are allowed.', 'Room full rejection message');
          resolve();
        }
      });
    });

    charlieWs.send(JSON.stringify({
      type: 'REQUEST_ADMISSION',
      roomId: roomId,
      nickname: 'Charlie'
    }));

    await charlieRejected;
    console.log('  [PASS] Third participant immediately rejected with ROOM_FULL.');

    // ------------------------------------------------------------------------
    // TEST 5: E2EE CIPHERTEXT RELAY & PRESERVATION OF PRIVACY
    // ------------------------------------------------------------------------
    console.log('\n--- Test 5: End-to-End Encrypted Message Delivery ---');
    let bobReceivedCiphertext = false;
    let bobMsgWait = new Promise((resolve) => {
      bobWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ENCRYPTED_MESSAGE') {
          assertEqual(msg.payload.ciphertext, '4k3j2h1g==', 'Ciphertext payload untouched by server');
          bobReceivedCiphertext = true;
          resolve();
        }
      });
    });

    aliceWs.send(JSON.stringify({
      type: 'ENCRYPTED_MESSAGE',
      roomId: roomId,
      creatorSecret: aliceSecret,
      payload: { ciphertext: '4k3j2h1g==', iv: 'a1b2c3d4' },
      senderNick: 'Alice',
      timestamp: Date.now()
    }));

    await bobMsgWait;
    assert(bobReceivedCiphertext, 'Ciphertext transmitted end-to-end without server modification');
    console.log('  [PASS] Genuine E2EE message relayed.');

    // ------------------------------------------------------------------------
    // TEST 6: CLEAR CHAT FOR BOTH & CUTOFF OF DELAYED MESSAGES
    // ------------------------------------------------------------------------
    console.log('\n--- Test 6: Clear Chat For Both & Replay Prevention ---');
    let aliceClearNotified = false;
    let bobClearNotified = false;
    let clearCutoffTime = 0;

    const clearPromise = new Promise((resolve) => {
      let count = 0;
      const checkDone = () => { if (++count === 2) resolve(); };

      aliceWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CHAT_CLEARED') {
          aliceClearNotified = true;
          clearCutoffTime = msg.clearedAt;
          checkDone();
        }
      });

      bobWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CHAT_CLEARED') {
          bobClearNotified = true;
          checkDone();
        }
      });
    });

    // Bob requests clear chat
    bobWs.send(JSON.stringify({
      type: 'CLEAR_CHAT',
      roomId: roomId,
      guestToken: bobWs.guestToken
    }));

    await clearPromise;
    assert(aliceClearNotified && bobClearNotified, 'Both participants received CHAT_CLEARED');
    assert(clearCutoffTime > 0, 'Clear cutoff timestamp generated by server');

    // Test delayed message rejection: Send message timestamped before clearCutoffTime
    let delayedMsgReachedBob = false;
    bobWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_MESSAGE' && msg.payload.ciphertext === 'staleDelayedPayload') {
        delayedMsgReachedBob = true;
      }
    });

    aliceWs.send(JSON.stringify({
      type: 'ENCRYPTED_MESSAGE',
      roomId: roomId,
      creatorSecret: aliceSecret,
      payload: { ciphertext: 'staleDelayedPayload' },
      senderNick: 'Alice',
      timestamp: clearCutoffTime - 5000 // In past prior to clear!
    }));

    await sleep(200);
    assert(!delayedMsgReachedBob, 'Server dropped delayed message sent prior to chat clear');
    console.log('  [PASS] Clear chat for both synchronized and stale delayed messages dropped.');

    // ------------------------------------------------------------------------
    // TEST 7: CREATOR CONTROLS: REMOVE GUEST & REVOKE ACCESS
    // ------------------------------------------------------------------------
    console.log('\n--- Test 7: Creator Removes Guest & Revokes Access ---');
    let bobRemovedNotified = new Promise((resolve) => {
      bobWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'REMOVED_BY_CREATOR') {
          assertEqual(msg.message, 'You have been removed from the room by the creator.', 'Safe generic notice');
          resolve();
        }
      });
    });

    aliceWs.send(JSON.stringify({
      type: 'REMOVE_GUEST',
      roomId: roomId,
      creatorSecret: aliceSecret
    }));

    await bobRemovedNotified;
    console.log('  [PASS] Guest access immediately revoked and notified.');

    // ------------------------------------------------------------------------
    // TEST 8: PREVENT RECONNECTION WITH STALE GUEST CREDENTIALS
    // ------------------------------------------------------------------------
    console.log('\n--- Test 8: Stale Guest Token Reconnection Rejected ---');
    const staleBobWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    await new Promise(r => staleBobWs.on('open', r));

    let staleRejected = new Promise((resolve) => {
      staleBobWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ADMISSION_REJECTED') {
          assert(msg.message.includes('removed from this room and cannot rejoin with stale credentials'), 'Stale credentials rejected');
          resolve();
        }
      });
    });

    staleBobWs.send(JSON.stringify({
      type: 'REQUEST_ADMISSION',
      roomId: roomId,
      guestId: bobGuestId,
      nickname: 'Bob'
    }));

    await staleRejected;
    console.log('  [PASS] Removed guest cannot reconnect with stale credentials.');

    // ------------------------------------------------------------------------
    // TEST 9: ONE-TO-MANY SEQUENTIAL ADMISSION: ADMIT A NEW GUEST
    // ------------------------------------------------------------------------
    console.log('\n--- Test 9: Creator Admits a Different Guest (David) ---');
    const davidWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    await new Promise(r => davidWs.on('open', r));

    let davidAdmittedPromise = new Promise((resolve) => {
      davidWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ADMISSION_GRANTED') {
          resolve();
        }
      });
    });

    let creatorSawDavid = new Promise((resolve) => {
      aliceWs.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ADMISSION_REQUEST' && msg.nickname === 'David') {
          resolve(msg.guestId);
        }
      });
    });

    davidWs.send(JSON.stringify({
      type: 'REQUEST_ADMISSION',
      roomId: roomId,
      nickname: 'David'
    }));

    const davidGuestId = await creatorSawDavid;
    aliceWs.send(JSON.stringify({
      type: 'ADMIT_GUEST',
      roomId: roomId,
      guestId: davidGuestId,
      creatorSecret: aliceSecret
    }));

    await davidAdmittedPromise;
    console.log('  [PASS] Creator successfully admitted a new guest (David).');

    // Cleanup
    aliceWs.close();
    davidWs.close();
    staleBobWs.close();
    bobWs.close();
    charlieWs.close();

    console.log('\n===============================================================');
    console.log('  ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! (100% PASSED)  ');
    console.log('===============================================================');
  } finally {
    server.close();
  }
}

runIntegrationTests()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n\x1b[31m[Integration Test FAILED]\x1b[0m', err);
    process.exit(1);
  });
