/**
 * agora-token.js — Generates Agora RTC tokens for voice rooms.
 *
 * The app calls this to get a token before joining a voice room.
 * Uses the Agora App ID + App Certificate from your account.
 */

const AgoraRTC = require('agora-access-token');
const config = require('./config');

/**
 * Generate an RTC token.
 * @param {string} channelName - the voice room channel name
 * @param {string} uid - user ID (string or number, 0 for any)
 * @param {number} role - 1 = publisher (can speak), 2 = subscriber (listen only)
 * @param {number} expireSeconds - token validity (default 24h)
 */
function generateRtcToken(channelName, uid, role, expireSeconds) {
  const { appId, appCertificate } = config.agora;
  if (!appId || !appCertificate) {
    throw new Error('AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured');
  }
  const effectiveRole = role === 2 ? AgoraRTC.RtcRole.SUBSCRIBER : AgoraRTC.RtcRole.PUBLISHER;
  const expirationTimeInSeconds = expireSeconds || 86400; // 24 hours
  const currentTimestamp = Math.floor(Date.now() / 1000);
  // Agora's privilegeExpiredTs is a uint32 — cap it to avoid overflow
  const privilegeExpiredTs = Math.min(currentTimestamp + expirationTimeInSeconds, 4294967295);
  const numericUid = parseInt(uid, 10) || 0;

  return AgoraRTC.RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    numericUid,
    effectiveRole,
    privilegeExpiredTs
  );
}

module.exports = { generateRtcToken };

// If run directly: generate a test token
if (require.main === module) {
  const channel = process.argv[2] || 'test-room';
  const uid = process.argv[3] || '0';
  try {
    const token = generateRtcToken(channel, uid, 1);
    console.log('Agora RTC Token:');
    console.log(token);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}
