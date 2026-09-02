/**
 * keygen.js — Generates the cryptographic keys your server and app need.
 *
 * Run ONCE:  npm run keygen
 *
 * It produces:
 *   1. APP_SIGNING_SECRET       — a 256-bit hex secret for signing app<->server requests
 *   2. ENTITLEMENT_PUBLIC_KEY_HEX  — Ed25519 public key (goes into the APK's strings.xml)
 *   3. ENTITLEMENT_PRIVATE_KEY_HEX — Ed25519 private key (stays on the server ONLY)
 *
 * After running, copy the output into your .env file (and Render env vars).
 * The PUBLIC key also goes into the APK — I will put it there for you.
 */

const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const crypto = require('crypto');

console.log('\n========================================');
console.log('  Talkin Pro — Key Generator');
console.log('========================================\n');

// 1. Signing secret (256-bit / 32-byte random hex = 64 hex chars)
const signingSecret = crypto.randomBytes(32).toString('hex');

// 2. Ed25519 keypair for entitlement signing
const keypair = nacl.sign.keyPair();
const publicKeyHex = Buffer.from(keypair.publicKey).toString('hex');
const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');

// 3. Tencent message key (256-bit random hex)
const tencentMsgKey = crypto.randomBytes(32).toString('hex');

console.log('Add these to your .env file (and Render Environment Variables):\n');
console.log('─'.repeat(60));
console.log(`APP_SIGNING_SECRET=${signingSecret}`);
console.log(`ENTITLEMENT_PUBLIC_KEY_HEX=${publicKeyHex}`);
console.log(`ENTITLEMENT_PRIVATE_KEY_HEX=${privateKeyHex}`);
console.log(`TENCENT_MSG_KEY=${tencentMsgKey}`);
console.log('─'.repeat(60));

console.log('\n⚠️  IMPORTANT:');
console.log('  • ENTITLEMENT_PRIVATE_KEY_HEX  →  stays on the server ONLY (never in the APK)');
console.log('  • ENTITLEMENT_PUBLIC_KEY_HEX  →  also goes into the APK strings.xml');
console.log('  • APP_SIGNING_SECRET           →  also goes into the APK strings.xml');
console.log('  • TENCENT_MSG_KEY              →  server only');
console.log('\n✅ Copy the 4 lines above into your .env file now.\n');
