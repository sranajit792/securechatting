/**
 * VanishText {Made by SUVX}
 * Serverless / API Endpoint: Health Check
 */

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.statusCode = 200;
  res.end(JSON.stringify({
    status: 'ok',
    service: 'VanishText Signaling & TURN Authority',
    timestamp: Date.now()
  }));
};
