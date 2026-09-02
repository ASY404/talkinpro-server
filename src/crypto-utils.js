/**
 * crypto-utils.js — Cryptographic helpers for entitlements and Tencent IM messages.
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const config = require('./config');

/**
 * Sign a payload with the Ed25519 private key.
 * Returns a base64 signature.
 */
function signPayload(payloadObj) {
  const privateKeyHex = config.entitlementPrivateKeyHex;
  if (!privateKeyHex) {
    throw new Error('ENTITLEMENT_PRIVATE_KEY_HEX not configured');
  }
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const message = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const signature = nacl.sign.detached(message, secretKey);
  return naclUtil.encodeBase64(signature);
}

/**
 * Verify a signature with the Ed25519 public key (used by the app).
 */
function verifyPayload(payloadObj, signatureB64) {
  const publicKeyHex = config.entitlementPublicKeyHex;
  if (!publicKeyHex) return false;
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  const message = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const signature = naclUtil.decodeBase64(signatureB64);
  return nacl.sign.detached.verify(message, signature, publicKey);
}

/**
 * HMAC-SHA256 signature for app<->server request signing.
 * The app sends a header like: X-Signature: <hex hmac>
 */
function computeHmac(body, secret) {
  return crypto
    .createHmac('sha256', secret || config.signingSecret)
    .update(body)
    .digest('hex');
}

function verifyHmac(body, signature, secret) {
  if (!signature || !secret) return false;
  const expected = computeHmac(body, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Encrypt a Tencent IM message.
 * Uses AES-256-GCM with the TENCENT_MSG_KEY.
 * Returns: { ciphertext, iv, tag } as hex strings.
 *
 * The app's /v1/sec/enc/tienc endpoint expects encrypted content.
 */
function encryptTencentMessage(plaintext) {
  const key = Buffer.from(config.tencent.msgKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TENCENT_MSG_KEY must be 32 bytes (64 hex chars)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a Tencent IM message.
 * Input: { ciphertext, iv, tag } as hex strings.
 */
function decryptTencentMessage(encryptedObj) {
  const key = Buffer.from(config.tencent.msgKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TENCENT_MSG_KEY must be 32 bytes (64 hex chars)');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encryptedObj.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedObj.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedObj.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

module.exports = {
  signPayload,
  verifyPayload,
  computeHmac,
  verifyHmac,
  encryptTencentMessage,
  decryptTencentMessage,
};
