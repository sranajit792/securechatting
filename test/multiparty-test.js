/**
 * Multi-Participant E2EE, Admission, Removal & Clear Chat Test
 */
const WebSocket = require('ws');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

async function run() {
  console.log('===============================================================');
  console.log('   MULTI-PARTICIPANT, CREATOR REMOVAL & CLEAR-CHAT E2E TEST    ');
  console.log('===============================================================');

  const WS_URL = 'ws://localhost:8080/ws';
  const roomId = 'MULTIPARTY88';

  // Step 1: Alice creates a room with capacity 4 and roomType 'group'
  console.log('\n--- Step 1: Alice creates room (capacity: 4) ---');
  const aliceWs = new WebSocket(WS_URL);
  await new Promise(r => aliceWs.on('open', r));

  let aliceSecret = null;
  const aliceCreatedPromise = new Promise(resolve => {
    aliceWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ROOM_CREATED') {
        aliceSecret = msg.creatorSecret;
        resolve(msg);
      }
    });
  });

  aliceWs.send(JSON.stringify({
    type: 'CREATE_ROOM',
    roomId: roomId,
    nickname: 'AliceOwner',
    maxParticipants: 4,
    roomType: 'group'
  }));

  const createdMsg = await aliceCreatedPromise;
  assertEqual(createdMsg.maxParticipants, 4, 'Room configured with capacity 4');
  assertEqual(createdMsg.roomType, 'group', 'Room configured with roomType group');
  console.log('  [PASS] Room MULTIPARTY88 created with capacity 4.');

  // Step 2: Bob requests admission
  console.log('\n--- Step 2: Bob requests admission & Alice admits Bob ---');
  const bobWs = new WebSocket(WS_URL);
  await new Promise(r => bobWs.on('open', r));

  let bobGuestId = null;
  const bobAdmitWait = new Promise(resolve => {
    bobWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'WAITING_FOR_ADMISSION') {
        bobGuestId = msg.guestId;
      } else if (msg.type === 'ADMISSION_GRANTED') {
        bobWs.guestToken = msg.guestToken;
        resolve(msg);
      }
    });
  });

  const aliceSawBobRequest = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_REQUEST' && msg.nickname === 'Bob') {
        aliceWs.off('message', handler);
        resolve(msg);
      }
    };
    aliceWs.on('message', handler);
  });

  bobWs.send(JSON.stringify({
    type: 'REQUEST_ADMISSION',
    roomId: roomId,
    nickname: 'Bob'
  }));

  const bobReq = await aliceSawBobRequest;
  aliceWs.send(JSON.stringify({
    type: 'ADMIT_GUEST',
    roomId: roomId,
    guestId: bobReq.guestId,
    creatorSecret: aliceSecret
  }));

  await bobAdmitWait;
  console.log('  [PASS] Bob admitted successfully.');

  // Step 3: Charlie requests admission & Alice admits Charlie
  console.log('\n--- Step 3: Charlie requests admission & Alice admits Charlie ---');
  const charlieWs = new WebSocket(WS_URL);
  await new Promise(r => charlieWs.on('open', r));

  let charlieGuestId = null;
  const charlieAdmitWait = new Promise(resolve => {
    charlieWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'WAITING_FOR_ADMISSION') {
        charlieGuestId = msg.guestId;
      } else if (msg.type === 'ADMISSION_GRANTED') {
        charlieWs.guestToken = msg.guestToken;
        resolve(msg);
      }
    });
  });

  const aliceSawCharlieRequest = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_REQUEST' && msg.nickname === 'Charlie') {
        aliceWs.off('message', handler);
        resolve(msg);
      }
    };
    aliceWs.on('message', handler);
  });

  charlieWs.send(JSON.stringify({
    type: 'REQUEST_ADMISSION',
    roomId: roomId,
    nickname: 'Charlie'
  }));

  const charlieReq = await aliceSawCharlieRequest;
  aliceWs.send(JSON.stringify({
    type: 'ADMIT_GUEST',
    roomId: roomId,
    guestId: charlieReq.guestId,
    creatorSecret: aliceSecret
  }));

  await charlieAdmitWait;
  console.log('  [PASS] Charlie admitted successfully (Total participants: 3).');

  // Step 4: Encrypted Message Delivery from Bob -> Alice and Charlie receive it
  console.log('\n--- Step 4: Bob sends E2EE message; Alice & Charlie receive it ---');
  let aliceGotMsg = false;
  let charlieGotMsg = false;

  const msgWait = new Promise(resolve => {
    let count = 0;
    const checkDone = () => { if (++count === 2) resolve(); };

    aliceWs.on('message', function h(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_MESSAGE' && msg.payload.ciphertext === 'CiphertextFromBob') {
        aliceGotMsg = true;
        aliceWs.off('message', h);
        checkDone();
      }
    });

    charlieWs.on('message', function h(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_MESSAGE' && msg.payload.ciphertext === 'CiphertextFromBob') {
        charlieGotMsg = true;
        charlieWs.off('message', h);
        checkDone();
      }
    });
  });

  bobWs.send(JSON.stringify({
    type: 'ENCRYPTED_MESSAGE',
    roomId: roomId,
    guestToken: bobWs.guestToken,
    payload: { ciphertext: 'CiphertextFromBob', iv: 'iv123' },
    senderNick: 'Bob',
    timestamp: Date.now()
  }));

  await msgWait;
  assert(aliceGotMsg, 'Alice received Bob message');
  assert(charlieGotMsg, 'Charlie received Bob message');
  console.log('  [PASS] E2EE message received by both Alice and Charlie.');

  // Step 5: CLEAR CHAT FOR EVERYONE triggered by Alice
  console.log('\n--- Step 5: Alice triggers CLEAR CHAT FOR EVERYONE ---');
  let bobCleared = false;
  let charlieCleared = false;

  const clearWait = new Promise(resolve => {
    let count = 0;
    const checkDone = () => { if (++count === 2) resolve(); };

    bobWs.on('message', function h(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'CHAT_CLEARED') {
        bobCleared = true;
        bobWs.off('message', h);
        checkDone();
      }
    });

    charlieWs.on('message', function h(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'CHAT_CLEARED') {
        charlieCleared = true;
        charlieWs.off('message', h);
        checkDone();
      }
    });
  });

  aliceWs.send(JSON.stringify({
    type: 'CLEAR_CHAT',
    roomId: roomId,
    creatorSecret: aliceSecret,
    clearedBy: 'AliceOwner'
  }));

  await clearWait;
  assert(bobCleared, 'Bob received CHAT_CLEARED notice');
  assert(charlieCleared, 'Charlie received CHAT_CLEARED notice');
  console.log('  [PASS] CLEAR CHAT FOR EVERYONE synchronized across all participants.');

  // Step 6: Alice removes Charlie
  console.log('\n--- Step 6: Alice removes Charlie from the room ---');
  let charlieRemovedNotice = false;
  const removeWait = new Promise(resolve => {
    charlieWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'REMOVED_BY_CREATOR') {
        charlieRemovedNotice = true;
        resolve();
      }
    });
  });

  aliceWs.send(JSON.stringify({
    type: 'REMOVE_GUEST',
    roomId: roomId,
    creatorSecret: aliceSecret,
    guestId: charlieReq.guestId
  }));

  await removeWait;
  assert(charlieRemovedNotice, 'Charlie received REMOVED_BY_CREATOR');
  console.log('  [PASS] Charlie successfully removed and notified.');

  // Step 7: Removed Charlie attempts to reconnect with stale credentials -> Rejected
  console.log('\n--- Step 7: Removed Charlie attempts to reconnect with stale credentials ---');
  const staleCharlieWs = new WebSocket(WS_URL);
  await new Promise(r => staleCharlieWs.on('open', r));

  let staleRejectedNotice = false;
  const staleWait = new Promise(resolve => {
    staleCharlieWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_REJECTED') {
        assert(msg.message.includes('removed from this room and cannot rejoin with stale credentials'), 'Stale token rejected');
        staleRejectedNotice = true;
        resolve();
      }
    });
  });

  staleCharlieWs.send(JSON.stringify({
    type: 'REQUEST_ADMISSION',
    roomId: roomId,
    nickname: 'Charlie',
    staleGuestToken: charlieWs.guestToken
  }));

  await staleWait;
  assert(staleRejectedNotice, 'Stale token connection was rejected by server');
  console.log('  [PASS] Removed participant cannot reconnect with stale credentials.');

  // Cleanup
  aliceWs.close();
  bobWs.close();
  staleCharlieWs.close();

  console.log('\n===============================================================');
  console.log('   ALL MULTI-PARTICIPANT & CREATOR CONTROL TESTS PASSED 100%!  ');
  console.log('===============================================================');
}

run().catch(err => {
  console.error('[FAILED]', err);
  process.exit(1);
});
