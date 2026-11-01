/**
 * VanishText {Made by SUVX}
 * Connection State Management & Retry Test Suite
 */

const { webcrypto } = require('crypto');
global.crypto = webcrypto;

// Polyfill window & document for headless testing of UI/Chat/Room components
const listeners = new Map();
global.window = {
  crypto: webcrypto,
  addEventListener: (evt, cb) => listeners.set(evt, cb),
  removeEventListener: (evt) => listeners.delete(evt),
  location: { host: 'localhost:8080', origin: 'http://localhost:8080', search: '' }
};

// Polyfill BroadcastChannel
global.BroadcastChannel = class MockBC {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    if (!MockBC.channels[this.name]) {
      MockBC.channels[this.name] = [];
    }
    MockBC.channels[this.name].push(this);
  }
  postMessage(data) {
    if (MockBC.channels[this.name]) {
      MockBC.channels[this.name].forEach(c => {
        if (c !== this && c.onmessage) {
          setTimeout(() => {
            if (c.onmessage) c.onmessage({ data });
          }, 0);
        }
      });
    }
  }
  close() {
    if (MockBC.channels[this.name]) {
      MockBC.channels[this.name] = MockBC.channels[this.name].filter(c => c !== this);
    }
  }
};
global.BroadcastChannel.channels = {};

// Load modules
require('../js/config.js');
require('../js/crypto.js');
require('../js/validation.js');
require('../js/transport.js');
require('../js/rooms.js');
require('../js/chat.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
}

async function runStateTests() {
  console.log('===============================================================');
  console.log('     VANISHTEXT — CONNECTION STATE & RETRY VERIFICATION SUITE   ');
  console.log('===============================================================');

  // Test 1: Explicit Connection States in ROOM_STATES
  console.log('\n--- Test 1: Explicit Connection States in ROOM_STATES ---');
  const expectedStates = ['CONNECTING', 'SIGNALING', 'NEGOTIATING', 'VERIFYING', 'CONNECTED', 'FAILED'];
  for (const st of expectedStates) {
    assert(window.VANISH_ROOM_STATES[st] === st, `State ${st} is defined in VANISH_ROOM_STATES`);
  }
  console.log('  [PASS] All explicit states present: CONNECTING, SIGNALING, NEGOTIATING, VERIFYING, CONNECTED, FAILED.');

  // Test 1b: emitState method existence on transports
  console.log('\n--- Test 1b: emitState method existence on transports ---');
  let stateReceived = null;
  let detailsReceived = null;
  const dummyTransport = new window.PeerJsTransport({
    onStateChange: (st, det) => {
      stateReceived = st;
      detailsReceived = det;
    }
  });
  assert(typeof dummyTransport.emitState === 'function', 'PeerJsTransport.emitState is a function');
  dummyTransport.emitState('CONNECTING', { message: 'Testing state' });
  assert(stateReceived === 'CONNECTING', 'emitState dispatched CONNECTING to onStateChange');
  assert(detailsReceived && detailsReceived.message === 'Testing state', 'emitState passed details');
  console.log('  [PASS] PeerJsTransport.emitState verified and functional.');

  // Test 2: Sequential State Emission during Host Room Creation
  console.log('\n--- Test 2: Room Creation Flow Emits States ---');
  const creator = new window.VanishRoomSession();
  const creatorStates = [];
  creator.onStateChange((state, details) => {
    creatorStates.push({ state, details });
  });

  await creator.createRoom('AliceHost', 'TestRoom', 'broadcast');
  assert(creatorStates.some(s => s.state === 'CREATING'), 'CREATING state emitted');
  assert(creatorStates.some(s => s.state === 'WAITING_FOR_PEER'), 'WAITING_FOR_PEER state emitted on transport ready');
  console.log('  [PASS] Room creation emitted states cleanly.');

  // Test 3: Guest Join Flow with BroadcastChannel Transport
  console.log('\n--- Test 3: Guest Join Flow & Verification State ---');
  const guest = new window.VanishRoomSession();
  const guestStates = [];
  guest.onStateChange((state, details) => {
    guestStates.push({ state, details });
  });

  await guest.joinRoom(creator.formattedCode, 'BobGuest', 'broadcast');
  assert(guestStates.some(s => s.state === 'JOINING'), 'JOINING state emitted');
  assert(guest.lastJoinParams && guest.lastJoinParams.rawCode === creator.formattedCode, 'lastJoinParams recorded for retry');

  // Wait for session handshake
  await new Promise(r => setTimeout(r, 200));
  assert(creator.state === 'CONNECTED', 'Creator transitioned to CONNECTED');
  assert(guest.state === 'CONNECTED', 'Guest transitioned to CONNECTED');
  assert(creator.crypto.hasActiveSession(), 'Creator E2EE crypto session established');
  assert(guest.crypto.hasActiveSession(), 'Guest E2EE crypto session established');
  console.log('  [PASS] Guest joined, states progressed to CONNECTED with active E2EE.');

  // Test 4: Retry Connection Mechanism
  console.log('\n--- Test 4: Retry Connection Support ---');
  assert(guest.lastJoinParams !== null, 'lastJoinParams retained after teardown');
  
  const retryPromise = guest.retryConnection();
  await retryPromise;
  await new Promise(r => setTimeout(r, 200));
  assert(guest.state === 'CONNECTED', 'Guest successfully reconnected via retryConnection()');
  console.log('  [PASS] retryConnection() successfully re-established session.');

  // Clean up
  creator.leaveRoom();
  guest.leaveRoom();

  console.log('\n===============================================================');
  console.log('  ALL CONNECTION STATE TESTS PASSED SUCCESSFULLY! (100% PASS)  ');
  console.log('===============================================================');
}

runStateTests().catch(err => {
  console.error('\n[FAILED]:', err);
  process.exit(1);
});
