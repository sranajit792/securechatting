/**
 * VanishText {Made by SUVX}
 * Serverless / API Endpoint: Dynamic Secure Ephemeral TURN Credentials (RFC 5766)
 *
 * Compatible with:
 * - Vercel Serverless Functions (/api/turn-credentials)
 * - Standalone Node.js HTTP servers
 * - Custom Coturn / Xirsys / Metered / Twilio backend configurations
 *
 * Never exposes the TURN shared secret to frontend clients.
 * Generates short-lived, time-limited credentials on demand.
 */

const crypto = require('crypto');

function generateTurnCredentials(forceRelay = false) {
  const ttlSeconds = 86400; // 24-hour expiration for generated ephemeral tokens
  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = process.env.TURN_USERNAME || `${timestamp}:vanishtext-${crypto.randomBytes(4).toString('hex')}`;
  const turnSecret = process.env.TURN_SECRET || process.env.COTURN_SECRET || 'openrelayproject';

  // Dynamic HMAC-SHA1 calculation (RFC 5766 REST API Authentication)
  let password = process.env.TURN_CREDENTIAL;
  if (!password) {
    const hmac = crypto.createHmac('sha1', turnSecret);
    hmac.update(username);
    password = hmac.digest('base64');
  }

  let iceServers;
  const rawUrls = process.env.TURN_URLS || process.env.COTURN_URLS;
  if (rawUrls) {
    const customUrls = rawUrls.split(',').map(u => u.trim()).filter(Boolean);
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      ...customUrls.map(u => ({ urls: u, username, credential: password }))
    ];
  } else {
    // Multi-network, cross-ISP, firewall/VPN-friendly public ICE servers
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      // Multi-network TURN relays across UDP, TCP, and TLS (Ports 80 & 443)
      {
        urls: 'turn:relay.metered.ca:80',
        username: username,
        credential: password
      },
      {
        urls: 'turn:relay.metered.ca:443',
        username: username,
        credential: password
      },
      {
        urls: 'turn:relay.metered.ca:443?transport=tcp',
        username: username,
        credential: password
      },
      {
        urls: 'turns:relay.metered.ca:443?transport=tcp',
        username: username,
        credential: password
      }
    ];
  }

  return {
    iceServers,
    iceTransportPolicy: forceRelay ? 'relay' : 'all',
    expiresAt: Date.now() + (ttlSeconds * 1000)
  };
}

module.exports = (req, res) => {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const queryUrl = req.url || '';
  const isRelay = queryUrl.includes('mode=relay') || queryUrl.includes('relay=true') || process.env.FORCE_TURN_RELAY === 'true';
  const credentials = generateTurnCredentials(isRelay);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(JSON.stringify(credentials));
};
