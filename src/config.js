/**
 * config.js — Central configuration loaded from environment variables.
 */

require('dotenv').config();

function required(name, fallback) {
  const v = process.env[name] || fallback;
  if (v === undefined || v === null || v === '') {
    console.warn(`⚠️  Config: ${name} is not set — using fallback or empty.`);
  }
  return v;
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || '',

  // App version control (the update mechanism)
  app: {
    latestVersion: required('APP_LATEST_VERSION', '1.0.0'),
    minVersion: required('APP_MIN_VERSION', '1.0.0'),
    downloadUrl: required('APP_DOWNLOAD_URL', ''),
    discordUrl: process.env.DISCORD_INVITE_URL || '',
    changelog: [
      process.env.APP_CHANGELOG_1,
      process.env.APP_CHANGELOG_2,
      process.env.APP_CHANGELOG_3,
      process.env.APP_CHANGELOG_4,
      process.env.APP_CHANGELOG_5,
    ].filter(Boolean),
  },

  // Crypto / license
  signingSecret: required('APP_SIGNING_SECRET', ''),
  entitlementPublicKeyHex: required('ENTITLEMENT_PUBLIC_KEY_HEX', ''),
  entitlementPrivateKeyHex: required('ENTITLEMENT_PRIVATE_KEY_HEX', ''),
  keyPrefix: 'TALKPRO_', // Hardcoded — ALL CAPS prefix (matches patched app bundle)
  freeEntitlement: (process.env.FREE_ENTITLEMENT || 'true').toLowerCase() === 'true',

  // Agora
  agora: {
    appId: required('AGORA_APP_ID', ''),
    appCertificate: required('AGORA_APP_CERTIFICATE', ''),
  },

  // Tencent
  tencent: {
    sdkAppId: required('TENCENT_SDK_APP_ID', '1721000587'),
    msgKey: required('TENCENT_MSG_KEY', ''),
  },

  // Firebase
  firebase: {
    credentials: process.env.FIREBASE_CREDENTIALS || '',
    credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH || '',
  },
};

module.exports = config;
