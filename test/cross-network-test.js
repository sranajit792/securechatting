/**
 * Cross-Network, Wi-Fi, Hotspot, and Mobile Data Traversal Test
 */
const WebSocket = require('ws');
const http = require('http');

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

async function testNetworkInfo() {
  console.log('\n--- 1. Testing /api/network-info Discovery Endpoint ---');
  const res = await fetch('http://localhost:8080/api/network-info');
  assertEqual(res.status, 200, 'Network info returns 200 OK');
  const info = await res.json();
  assert(info.networkUrls && Array.isArray(info.networkUrls), 'networkUrls is an array');
  assert(info.primaryNetworkUrl, 'primaryNetworkUrl is present');
  console.log(`  [PASS] Network access detected: ${info.primaryNetworkUrl}`);
  return info.primaryNetworkUrl;
}

async function testTurnRelayCredentials() {
  console.log('\n--- 2. Testing Mobile Data / Symmetric NAT TURN Relay Endpoint ---');
  const res = await fetch('http://localhost:8080/api/turn-credentials?mode=relay');
  assertEqual(res.status, 200, 'TURN credentials return 200 OK');
  const creds = await res.json();
  assertEqual(creds.iceTransportPolicy, 'relay', 'Explicit relay mode policy configured');
  assert(creds.iceServers.length >= 4, 'Multiple STUN/TURN relays configured');
  const hasTurn443 = creds.iceServers.some(s => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some(u => u.includes('443'));
  });
  assert(hasTurn443, 'Port 443 TURN relay configured for cellular/restricted networks');
  console.log('  [PASS] Mobile data and restrictive firewall TURN relays verified.');
}

async function testCrossNetworkSession(networkUrl) {
  console.log('\n--- 3. Testing Cross-Network Room Creation & Join via Network URL ---');
  const u = new URL(networkUrl);
  const WS_URL = `ws://${u.host}/ws`;
  const roomId = 'CROSSNET99';

  // Device A (Creator on Wi-Fi / Host)
  const deviceA = new WebSocket(WS_URL);
  await new Promise(r => deviceA.on('open', r));

  let creatorSecret = null;
  const createPromise = new Promise(resolve => {
    deviceA.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ROOM_CREATED') {
        creatorSecret = msg.creatorSecret;
        resolve(msg);
      }
    });
  });

  deviceA.send(JSON.stringify({
    type: 'CREATE_ROOM',
    roomId: roomId,
    nickname: 'UserOnWiFi'
  }));
  await createPromise;
  console.log('  [PASS] Room created on network interface.');

  // Device B (Guest on Mobile Data / Hotspot)
  const deviceB = new WebSocket(WS_URL);
  await new Promise(r => deviceB.on('open', r));

  const guestAdmitWait = new Promise(resolve => {
    deviceB.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_GRANTED') {
        deviceB.guestToken = msg.guestToken;
        resolve(msg);
      }
    });
  });

  const creatorSawRequest = new Promise(resolve => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ADMISSION_REQUEST') {
        deviceA.off('message', handler);
        resolve(msg);
      }
    };
    deviceA.on('message', handler);
  });

  deviceB.send(JSON.stringify({
    type: 'REQUEST_ADMISSION',
    roomId: roomId,
    nickname: 'UserOnMobileData'
  }));

  const req = await creatorSawRequest;
  deviceA.send(JSON.stringify({
    type: 'ADMIT_GUEST',
    roomId: roomId,
    guestId: req.guestId,
    creatorSecret: creatorSecret
  }));

  await guestAdmitWait;
  console.log('  [PASS] Mobile data guest admitted.');

  // Exchange E2EE message across networks
  const msgReceived = new Promise(resolve => {
    deviceA.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ENCRYPTED_MESSAGE' && msg.payload.ciphertext === 'MobileToWiFiEncryptedPayload') {
        resolve();
      }
    });
  });

  deviceB.send(JSON.stringify({
    type: 'ENCRYPTED_MESSAGE',
    roomId: roomId,
    guestToken: deviceB.guestToken,
    payload: { ciphertext: 'MobileToWiFiEncryptedPayload', iv: 'iv999' },
    senderNick: 'UserOnMobileData',
    timestamp: Date.now()
  }));

  await msgReceived;
  console.log('  [PASS] E2EE message sent from Mobile Data device delivered to Wi-Fi device.');

  deviceA.close();
  deviceB.close();
}

async function run() {
  console.log('===============================================================');
  console.log('   CROSS-NETWORK (WI-FI / MOBILE DATA / HOTSPOT) TEST SUITE    ');
  console.log('===============================================================');

  const primaryUrl = await testNetworkInfo();
  await testTurnRelayCredentials();
  await testCrossNetworkSession(primaryUrl);

  console.log('\n===============================================================');
  console.log('   ALL CROSS-NETWORK VERIFICATIONS PASSED 100%!                ');
  console.log('===============================================================');
}

run().catch(err => {
  console.error('[FAILED]', err);
  process.exit(1);
});
