/**
 * keys.js — License key engine.
 *
 * Key lifecycle:
 *   create   → status=active (or disabled if admin chooses), no device bound, expiry set
 *   activate → first device binds; subsequent device on DIFFERENT device → warning, then BLOCK
 *   validate → returns current state: active | expired | blocked | disabled | device_mismatch
 *   disable  → status=disabled, app access revoked (key retained on server)
 *   enable   → status=active again
 *   reset    → new key string, old key invalidated on device, device binding cleared
 *   delete   → removed from store entirely
 *
 * Key types & durations:
 *   '1hour'     → 1 hour
 *   '1day'      → 1 day
 *   '1month'   → 30 days
 *   'custom'    → N days (1-60) via `durationDays`
 *   'permanent' → never expires
 *
 * Device binding rule (user requirement):
 *   1 key = 1 device ONLY.
 *   - 1st attempt on device A → bind, success
 *   - 1st attempt on device B (key already bound to A) → return "already_registered" warning,
 *     increment mismatch_attempts. Do NOT block yet.
 *   - 2nd attempt on device B → BLOCK the key + revoke app access for the user.
 *   Admin (ASY404) must intervene to unblock.
 */

const crypto = require('crypto');
const store = require('./store');

const KEY_PREFIX = 'talkpro_'; // Hardcoded — always generate talkpro_ keys (matches app bundle)

// ---------- Key generation ----------

function generateKeyString() {
  // 24 random hex chars → readable but unique
  const rand = crypto.randomBytes(12).toString('hex');
  return `${KEY_PREFIX}${rand}`;
}

/**
 * Create one or more keys.
 * @param {object} opts
 *   type: '1hour' | '1day' | '1month' | 'custom' | 'permanent'
 *   durationDays: number (only for 'custom')
 *   count: how many keys to generate (default 1)
 *   note: optional admin note
 *   status: 'active' | 'disabled' (default 'active')
 * @returns {KeyRecord[]}
 */
function createKeys(opts = {}) {
  const {
    type = 'permanent',
    durationDays = 1,
    count = 1,
    note = '',
    status = 'active',
  } = opts;

  if (!['1hour', '1day', '1month', 'custom', 'permanent'].includes(type)) {
    throw new Error('Invalid key type. Use: 1hour, 1day, 1month, custom, permanent');
  }
  if (type === 'custom' && (durationDays < 1 || durationDays > 60)) {
    throw new Error('Custom duration must be 1-60 days');
  }
  if (count < 1 || count > 500) {
    throw new Error('Count must be 1-500');
  }

  const now = new Date();
  let expiresAt = null;
  if (type === '1hour') expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  else if (type === '1day') expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  else if (type === '1month') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  else if (type === 'custom') expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  // permanent → expiresAt = null

  const created = [];
  for (let i = 0; i < count; i++) {
    let keyStr = generateKeyString();
    // ensure uniqueness
    while (store.getKey(keyStr)) keyStr = generateKeyString();

    const record = {
      key: keyStr,
      type,
      duration_days: type === 'custom' ? durationDays : (type === '1hour' ? null : type === '1day' ? 1 : type === '1month' ? 30 : null),
      status,                 // 'active' | 'disabled' | 'blocked'
      note,
      device_id: null,        // bound device
      device_info: null,      // optional info sent by app
      mismatch_attempts: 0,
      created_at: now.toISOString(),
      activated_at: null,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      reset_count: 0,
      reset_from: null,       // previous key string if this was a reset
      admin: 'ASY404',
    };
    store.putKey(keyStr, record);
    created.push(record);
  }
  return created;
}

// ---------- Expiry check ----------

function isExpired(record) {
  if (!record.expires_at) return false; // permanent
  return new Date(record.expires_at).getTime() < Date.now();
}

// ---------- Activation (device binding) ----------

/**
 * App calls this on first launch / key input.
 * @param {string} keyStr
 * @param {string} deviceId
 * @param {object} deviceInfo (optional)
 * @returns {object} { ok, status, code, message, key?, remaining_attempts? }
 *
 * Codes:
 *   ok               → activated / already active on this device
 *   already_registered → key bound to another device (1st mismatch)
 *   blocked          → 2nd mismatch → key blocked, access revoked
 *   expired          → time-based expiry hit
 *   disabled         → admin disabled
 *   not_found        → key doesn't exist
 *   invalid          → malformed
 */
function activateKey(keyStr, deviceId, deviceInfo = {}) {
  if (!keyStr || !deviceId) {
    return { ok: false, status: 'invalid', code: 'invalid', message: 'Key and device_id required' };
  }

  const record = store.getKey(keyStr);
  if (!record) {
    return { ok: false, status: 'not_found', code: 'not_found', message: 'Key not found. Contact admin ASY404.' };
  }

  // Blocked keys → no access
  if (record.status === 'blocked') {
    return { ok: false, status: 'blocked', code: 'blocked', message: 'This key has been blocked due to use on multiple devices. Contact admin ASY404 to restore.' };
  }

  // Disabled by admin
  if (record.status === 'disabled') {
    return { ok: false, status: 'disabled', code: 'disabled', message: 'This key is disabled. Contact admin ASY404.' };
  }

  // Reset by admin — old key no longer usable
  if (record.status === 'reset') {
    return { ok: false, status: 'reset', code: 'reset', message: 'This key has been reset. Use the new key from admin ASY404.' };
  }

  // Expiry check
  if (isExpired(record)) {
    record.status = 'expired';
    store.putKey(keyStr, record);
    return { ok: false, status: 'expired', code: 'expired', message: 'This key has expired. Contact admin ASY404 for a new key.' };
  }

  // Same device → already bound, all good
  if (record.device_id === deviceId) {
    record.activated_at = record.activated_at || new Date().toISOString();
    store.putKey(keyStr, record);
    return { ok: true, status: 'active', code: 'ok', message: 'Key active', key: record };
  }

  // Different device + key already bound → mismatch
  if (record.device_id && record.device_id !== deviceId) {
    record.mismatch_attempts = (record.mismatch_attempts || 0) + 1;

    if (record.mismatch_attempts === 1) {
      // First mismatch → warning, do NOT block yet
      store.putKey(keyStr, record);
      return {
        ok: false,
        status: 'already_registered',
        code: 'already_registered',
        message: 'This key is already registered on 1 device. Using it on another device will BLOCK the key. Contact admin ASY404.',
        remaining_attempts: 1,
      };
    } else {
      // 2nd mismatch → BLOCK
      record.status = 'blocked';
      store.putKey(keyStr, record);
      // log
      store.logActivity({
        device_id: deviceId,
        key: keyStr,
        type: 'key_blocked',
        detail: 'Blocked due to 2nd device mismatch attempt',
      });
      return {
        ok: false,
        status: 'blocked',
        code: 'blocked',
        message: 'This key has been BLOCKED for use on multiple devices. App access revoked. Contact admin ASY404 to restore.',
      };
    }
  }

  // No device bound yet → bind it now (first activation)
  record.device_id = deviceId;
  record.device_info = deviceInfo;
  record.activated_at = new Date().toISOString();
  record.status = 'active';
  store.putKey(keyStr, record);

  // Register/update device
  const dev = store.getDevice(deviceId) || {
    device_id: deviceId,
    first_seen: new Date().toISOString(),
    key: keyStr,
    info: deviceInfo,
  };
  dev.last_seen = new Date().toISOString();
  dev.key = keyStr;
  dev.info = { ...dev.info, ...deviceInfo };
  store.putDevice(deviceId, dev);

  store.logActivity({
    device_id: deviceId,
    key: keyStr,
    type: 'key_activated',
    detail: 'Key activated on device',
  });

  return { ok: true, status: 'active', code: 'ok', message: 'Key activated successfully', key: record };
}

// ---------- Validation (app calls periodically) ----------

/**
 * Lightweight check the app calls every launch / periodically.
 * Returns ok=false if access should be revoked (expired/blocked/disabled).
 */
function validateKey(keyStr, deviceId) {
  if (!keyStr || !deviceId) {
    return { ok: false, code: 'invalid', message: 'Key and device_id required' };
  }
  const record = store.getKey(keyStr);
  if (!record) return { ok: false, code: 'not_found', message: 'Key not found' };

  if (record.status === 'blocked') return { ok: false, code: 'blocked', message: 'Key blocked. Contact admin ASY404.' };
  if (record.status === 'disabled') return { ok: false, code: 'disabled', message: 'Key disabled. Contact admin ASY404.' };
  if (record.status === 'reset') return { ok: false, code: 'reset', message: 'This key has been reset. Use the new key provided by admin ASY404.' };
  if (isExpired(record)) {
    record.status = 'expired';
    store.putKey(keyStr, record);
    return { ok: false, code: 'expired', message: 'Key expired. Contact admin ASY404.' };
  }
  if (record.device_id && record.device_id !== deviceId) {
    return { ok: false, code: 'device_mismatch', message: 'Key registered on another device.' };
  }
  // update last seen
  const dev = store.getDevice(deviceId);
  if (dev) {
    dev.last_seen = new Date().toISOString();
    store.putDevice(deviceId, dev);
  }
  return { ok: true, code: 'ok', status: 'active', message: 'Key valid', key: sanitizeKey(record) };
}

// ---------- Admin controls ----------

function enableKey(keyStr) {
  const r = store.getKey(keyStr);
  if (!r) return null;
  if (r.status === 'expired') return { error: 'Cannot enable an expired key' };
  r.status = 'active';
  store.putKey(keyStr, r);
  store.logActivity({ key: keyStr, type: 'key_enabled', detail: 'Admin enabled key' });
  return r;
}

function disableKey(keyStr) {
  const r = store.getKey(keyStr);
  if (!r) return null;
  r.status = 'disabled';
  store.putKey(keyStr, r);
  store.logActivity({ key: keyStr, type: 'key_disabled', detail: 'Admin disabled key' });
  return r;
}

function unblockKey(keyStr) {
  const r = store.getKey(keyStr);
  if (!r) return null;
  r.status = 'active';
  r.mismatch_attempts = 0;
  store.putKey(keyStr, r);
  store.logActivity({ key: keyStr, type: 'key_unblocked', detail: 'Admin unblocked key' });
  return r;
}

/**
 * Reset → generate a brand new key string; old key invalidated.
 * Old key stays in store (for history) but is marked 'reset'.
 * Device binding cleared → user must re-activate with new key on their phone.
 */
function resetKey(keyStr) {
  const old = store.getKey(keyStr);
  if (!old) return null;
  // mark old as reset
  old.status = 'reset';
  store.putKey(keyStr, old);

  // create new key with same type/duration, fresh expiry
  const newRecord = {
    key: generateKeyString(),
    type: old.type,
    duration_days: old.duration_days,
    status: 'active',
    note: (old.note || '') + ' [reset]',
    device_id: null,
    device_info: null,
    mismatch_attempts: 0,
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: recomputeExpiry(old.type, old.duration_days),
    reset_count: (old.reset_count || 0) + 1,
    reset_from: keyStr,
    admin: 'ASY404',
  };
  store.putKey(newRecord.key, newRecord);
  store.logActivity({ key: keyStr, type: 'key_reset', detail: `Reset to ${newRecord.key}` });
  return { old: keyStr, new: newRecord.key, record: newRecord };
}

function recomputeExpiry(type, durationDays) {
  if (type === 'permanent') return null;
  const now = Date.now();
  if (type === '1hour') return new Date(now + 60 * 60 * 1000).toISOString();
  if (type === '1day') return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (type === '1month') return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (type === 'custom') return new Date(now + (durationDays || 1) * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function removeKey(keyStr) {
  store.logActivity({ key: keyStr, type: 'key_deleted', detail: 'Admin deleted key' });
  return store.deleteKey(keyStr);
}

// ---------- Sanitization (don't leak private fields to app) ----------

function sanitizeKey(record) {
  if (!record) return null;
  return {
    key: record.key,
    type: record.type,
    status: record.status,
    expires_at: record.expires_at,
    activated_at: record.activated_at,
    permanent: record.expires_at === null,
  };
}

module.exports = {
  createKeys,
  activateKey,
  validateKey,
  enableKey,
  disableKey,
  unblockKey,
  resetKey,
  removeKey,
  isExpired,
  sanitizeKey,
  generateKeyString,
};
