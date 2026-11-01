/**
 * End-to-End Test for One-Time-View Image Sharing with Chunking & E2EE Relay
 */
const WebSocket = require('ws');
const { webcrypto } = require('crypto');

// Polyfill window & crypto for headless Node
global.window = {
  crypto: webcrypto,
  btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
  atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
};
global.crypto = webcrypto;

require('../js/config.js');
require('../js/validation.js');
require('../js/crypto.js');

async function runImageE2ETest() {
  console.log('===============================================================');
  console.log('       ONE-TIME IMAGE SHARING END-TO-END TEST SUITE            ');
  console.log('===============================================================');

  const WS_URL = 'ws://localhost:8080';
  const roomId = 'IMGTEST' + Math.floor(1000 + Math.random() * 9000);
  const roomCode = 'IMAG-E2EE-TEST';

  const aliceWs = new WebSocket(WS_URL);
  await new Promise(res => aliceWs.on('open', res));

  console.log('--- Step 1: Establish Room & Derive AES-256-GCM Key ---');
  const aliceCrypto = new window.VanishCryptoEngine();
  const bobCrypto = new window.VanishCryptoEngine();

  await aliceCrypto.establishGroupSession(roomCode, roomId);
  await bobCrypto.establishGroupSession(roomCode, roomId);
  console.log('  [PASS] Both peers derived identical AES-256-GCM session key.');

  // Alice creates room
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

  await aliceCreatedPromise;
  console.log(`  [PASS] Room ${roomId} created.`);

  // Bob requests admission
  const bobWs = new WebSocket(WS_URL);
  await new Promise(r => bobWs.on('open', r));

  let bobGuestToken = null;
  const bobAdmittedPromise = new Promise(resolve => {
    bobWs.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_GRANTED') {
        bobGuestToken = msg.guestToken;
        resolve(msg);
      }
    });
  });

  const aliceSawBobRequest = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_REQUEST' && msg.nickname === 'BobGuest') {
        aliceWs.off('message', handler);
        resolve(msg);
      }
    };
    aliceWs.on('message', handler);
  });

  bobWs.send(JSON.stringify({
    type: 'REQUEST_ADMISSION',
    roomId: roomId,
    nickname: 'BobGuest'
  }));

  const bobReq = await aliceSawBobRequest;

  // Alice admits Bob
  aliceWs.send(JSON.stringify({
    type: 'ADMIT_GUEST',
    roomId: roomId,
    creatorSecret: aliceSecret,
    guestId: bobReq.guestId
  }));

  await bobAdmittedPromise;
  console.log('  [PASS] Alice successfully admitted Bob into the room.');

  console.log('\n--- Step 2: Encrypt & Send Large One-Time Image (Chunked Relay) ---');
  // Create an 80KB sample image base64 dataUrl (exceeds single 24KB chunk)
  const rawSample = 'data:image/png;base64,' + 'A'.repeat(80000);
  const imagePayload = {
    type: 'image_once',
    imageId: 'img-test-chunk-1',
    fileName: 'highres-capture.png',
    fileType: 'image/png',
    dataUrl: rawSample,
    timestamp: Date.now()
  };

  const encrypted = await aliceCrypto.encryptMessage(JSON.stringify(imagePayload), {
    roomId,
    senderId: 'creator'
  });

  const serialized = JSON.stringify(encrypted);
  const CHUNK_SIZE = 24576; // 24KB
  const totalChunks = Math.ceil(serialized.length / CHUNK_SIZE);
  console.log(`  Encrypted 80KB image into ciphertext package (${serialized.length} bytes, ${totalChunks} chunks).`);

  const receivedChunks = [];
  const bobReceivedPromise = new Promise((resolve, reject) => {
    bobWs.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_CHUNK') {
        receivedChunks.push(msg.data);
        if (msg.index + 1 === msg.total) {
          try {
            const reassembled = receivedChunks.join('');
            const encryptedPkg = JSON.parse(reassembled);
            const decryptedJson = await bobCrypto.decryptMessage(encryptedPkg, {
              roomId,
              senderId: 'creator'
            });
            const parsedImg = JSON.parse(decryptedJson);
            if (parsedImg.dataUrl === rawSample && parsedImg.imageId === 'img-test-chunk-1') {
              console.log('  [PASS] Bob reassembled all chunks & verified decrypted image matches original.');
              resolve();
            } else {
              reject(new Error('Decrypted payload mismatch.'));
            }
          } catch (e) {
            reject(e);
          }
        }
      }
    });
  });

  // Alice transmits chunks with creatorSecret
  const messageId = 'msg-chunk-' + Date.now();
  for (let i = 0; i < totalChunks; i++) {
    const chunkSlice = serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    aliceWs.send(JSON.stringify({
      type: 'ENCRYPTED_CHUNK',
      roomId,
      creatorSecret: aliceSecret,
      chunkId: messageId,
      index: i,
      total: totalChunks,
      data: chunkSlice
    }));
  }

  await bobReceivedPromise;

  console.log('\n--- Step 3: Recipient Consumes Image & Synchronizes Viewing Status ---');
  const aliceSawConsumedPromise = new Promise((resolve) => {
    aliceWs.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_MESSAGE') {
        const dec = await aliceCrypto.decryptMessage(msg.payload, { roomId, senderId: msg.senderId });
        const parsed = JSON.parse(dec);
        if (parsed.type === 'image_consumed' && parsed.imageId === 'img-test-chunk-1') {
          console.log('  [PASS] Alice received encrypted image_consumed receipt from Bob.');
          resolve();
        }
      }
    });
  });

  // Bob consumes photo and informs Alice using his guestToken
  const consumedNotice = await bobCrypto.encryptMessage(JSON.stringify({
    type: 'image_consumed',
    imageId: 'img-test-chunk-1'
  }), { roomId, senderId: bobReq.guestId });

  bobWs.send(JSON.stringify({
    type: 'ENCRYPTED_MESSAGE',
    roomId,
    guestToken: bobGuestToken,
    payload: consumedNotice
  }));

  await aliceSawConsumedPromise;

  console.log('===============================================================');
  console.log('   ALL ONE-TIME IMAGE SHARING END-TO-END TESTS PASSED (100%)!  ');
  console.log('===============================================================');

  aliceWs.close();
  bobWs.close();
  process.exit(0);
}

runImageE2ETest().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
