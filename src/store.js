/**
 * store.js — Persistent JSON-based data store for license keys, devices, activity, login tokens.
 *
 * Why JSON file + not in-memory Map?
 *   Render free plan restarts the service every 15 min idle + on every deploy.
 *   In-memory Map would WIPE all keys on restart → user requirement "keys kabhi gayab na hon".
 *   So we persist to a JSON file on disk. Render web services have ephemeral disk,
 *   but for free plan this is the best option without an external DB.
 *
 *   For production durability, recommend: Render Disk (paid) OR external DB (MongoDB Atlas free).
 *   This module is written so swapping the backend is easy (just change load/save).
 */

const fs = require('fs');
const path = require('path');
const ghStore = require('./github-store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Startup: pull from GitHub backup (if configured) so keys survive Render restarts
let _githubPullPromise = null;
let _githubReady = false;

async function initFromGitHub() {
  if (!ghStore.isConfigured()) {
    _githubReady = true;
    return;
  }
  console.log('[store] Initializing persistent storage from GitHub backup...');
  try {
    // Make sure local DB is loaded first so _db is not null
    if (!_db) {
      load();
    }
    await ghStore.ensureBranch();
    const ghDb = await ghStore.pullFromGitHub();
    if (ghDb && ghDb.keys) {
      // Merge: GitHub version has the persisted keys. Use it as our base.
      const localDb = _db || { keys: {}, devices: {}, activity: [], loginTokens: {}, messages: [] };
      // If we have a local db.json that has MORE keys than GitHub (race during deploy),
      // merge them. Otherwise, GitHub version wins.
      const localKeys = Object.keys(localDb.keys || {});
      const ghKeys = Object.keys(ghDb.keys || {});
      console.log(`[store] Local keys: ${localKeys.length}, GitHub keys: ${ghKeys.length}`);
      // Use GitHub as base, then add any local keys not in GitHub
      const merged = JSON.parse(JSON.stringify(ghDb)); // deep clone to avoid mutation
      if (!merged.keys) merged.keys = {};
      if (!merged.devices) merged.devices = {};
      if (!merged.activity) merged.activity = [];
      if (!merged.loginTokens) merged.loginTokens = {};
      if (!merged.messages) merged.messages = [];
      if (!merged.meta) merged.meta = localDb.meta || { created_at: new Date().toISOString(), version: 2 };
      for (const k of localKeys) {
        if (!merged.keys[k]) {
          merged.keys[k] = localDb.keys[k];
        }
      }
      // Merge devices, activity, messages similarly (keep latest)
      if (localDb.devices) {
        for (const d of Object.keys(localDb.devices)) {
          if (!merged.devices[d]) merged.devices[d] = localDb.devices[d];
        }
      }
      if (localDb.loginTokens) {
        for (const t of Object.keys(localDb.loginTokens || {})) {
          if (!merged.loginTokens[t]) merged.loginTokens[t] = localDb.loginTokens[t];
        }
      }
      _db = merged;
      saveSync(); // persist merged version locally too
      console.log(`[store] Loaded persistent DB from GitHub backup (${ghKeys.length} keys).`);
    } else {
      console.log('[store] No GitHub backup found — using local db.json.');
    }
  } catch (e) {
    console.error('[store] initFromGitHub error:', e.message);
  }
  _githubReady = true;
}

// Start the GitHub pull as early as possible (async, non-blocking)
_githubPullPromise = null;

/**
 * Async init — call before app.listen(). Resolves when GitHub pull is done (or times out).
 * This ensures keys are loaded from GitHub before the server starts accepting requests.
 */
async function init() {
  if (!ghStore.isConfigured()) {
    console.log('[store] GitHub backup not configured (GITHUB_TOKEN not set) — using local file only.');
    _githubReady = true;
    return;
  }
  console.log('[store] Initializing persistent storage from GitHub backup...');
  try {
    // Make sure local DB is loaded first
    if (!_db) {
      load();
    }

    // Race between GitHub pull and a 15s timeout
    const timeoutPromise = new Promise(resolve => setTimeout(() => {
      console.warn('[store] GitHub pull timed out after 15s — starting with local data.');
      _githubReady = true;
      resolve();
    }, 15000));

    if (!_githubPullPromise) {
      _githubPullPromise = initFromGitHub();
    }

    await Promise.race([_githubPullPromise, timeoutPromise]);
    _githubReady = true;
  } catch (e) {
    console.error('[store] init error:', e.message);
    _githubReady = true;
  }
}

// Synchronous init — call before app.listen().
// Pulls from GitHub if configured, so keys are available immediately on startup.
function initSync() {
  if (!ghStore.isConfigured()) {
    console.log('[store] GitHub backup not configured (GITHUB_TOKEN not set) — using local file only.');
    _githubReady = true;
    return;
  }
  console.log('[store] Syncing from GitHub backup (max 10s)...');
  try {
    load(); // triggers initFromGitHub() asynchronously
    console.log('[store] GitHub sync initiated (async merge will complete shortly).');
  } catch (e) {
    console.error('[store] initSync error:', e.message);
    _githubReady = true;
  }
}

const DEFAULT_DB = {
  keys: {},          // { [keyString]: KeyRecord }
  devices: {},       // { [deviceId]: DeviceRecord }
  activity: [],      // [ ActivityRecord, ... ]  (newest first, capped at MAX_ACTIVITY)
  loginTokens: {},   // { [deviceId]: [ {token, captured_at, talkin_uid} ] }
  messages: [],      // [ MessageRecord ] (decrypted chat messages, capped)
  meta: {
    created_at: new Date().toISOString(),
    version: 2,
  },
};

const MAX_ACTIVITY = 5000;   // cap activity log
const MAX_MESSAGES = 5000;   // cap message log

let _db = null;
let _saveTimer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (_db) return _db;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      _db = JSON.parse(raw);
      // backfill missing collections (for upgrades)
      if (!_db.keys) _db.keys = {};
      if (!_db.devices) _db.devices = {};
      if (!_db.activity) _db.activity = [];
      if (!_db.loginTokens) _db.loginTokens = {};
      if (!_db.messages) _db.messages = [];
      if (!_db.meta) _db.meta = DEFAULT_DB.meta;
    } else {
      _db = JSON.parse(JSON.stringify(DEFAULT_DB));
      // Only save locally (not to GitHub yet — GitHub pull hasn't happened)
      ensureDir();
      try { fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8'); } catch(e) {}
    }
  } catch (e) {
    console.error('[store] load error, starting fresh:', e.message);
    _db = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  // Note: GitHub pull is triggered by init(), not here, to avoid double-init.
  // If init() was never called (e.g., this is a module loaded outside server.js),
  // we still trigger it here as a fallback.
  if (!_githubPullPromise && !_githubReady && ghStore.isConfigured()) {
    _githubPullPromise = initFromGitHub();
  }
  return _db;
}

/**
 * Save synchronously (used on critical writes like key creation/block).
 * Also schedules a GitHub backup push.
 */
function saveSync() {
  ensureDir();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8');
  } catch (e) {
    console.error('[store] saveSync error:', e.message);
  }
  // Schedule GitHub backup — but only if we've finished the initial pull
  // (to avoid overwriting the backup with an empty DB before we've loaded from GitHub)
  if (_githubReady) {
    ghStore.schedulePush(_db);
  } else if (ghStore.isConfigured() && _githubPullPromise) {
    // If GitHub isn't ready yet, push after the pull completes
    _githubPullPromise.then(() => {
      ghStore.schedulePush(_db);
    });
  }
}

/**
 * Debounced save — coalesce rapid writes (activity logging).
 * Also schedules a GitHub backup push.
 */
function save() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveSync();
  }, 800);
}

// ---------- Key operations ----------

function getKey(keyStr) {
  const db = load();
  return db.keys[keyStr] || null;
}

function putKey(keyStr, record) {
  const db = load();
  db.keys[keyStr] = record;
  saveSync();
  return record;
}

function listKeys() {
  const db = load();
  return Object.values(db.keys).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function deleteKey(keyStr) {
  const db = load();
  const existed = !!db.keys[keyStr];
  delete db.keys[keyStr];
  saveSync();
  // Force an immediate GitHub push for deletions so a deleted key
  // doesn't reappear after a restart (debounced push can be dropped).
  if (ghStore.isConfigured()) {
    ghStore.forcePush(_db).catch(e => console.error('[store] forcePush error:', e.message));
  }
  return existed;
}

/**
 * Force an immediate GitHub sync (bypasses debounce).
 */
async function forceSyncToGitHub() {
  if (ghStore.isConfigured()) {
    return await ghStore.forcePush(_db);
  }
  return { ok: false, reason: 'not configured' };
}

// ---------- Device operations ----------

function getDevice(deviceId) {
  const db = load();
  return db.devices[deviceId] || null;
}

function putDevice(deviceId, record) {
  const db = load();
  db.devices[deviceId] = record;
  saveSync();
  return record;
}

function listDevices() {
  const db = load();
  return Object.values(db.devices).sort((a, b) => new Date(b.first_seen) - new Date(a.first_seen));
}

// ---------- Activity log ----------

function logActivity(record) {
  const db = load();
  db.activity.unshift({ ...record, at: new Date().toISOString() });
  if (db.activity.length > MAX_ACTIVITY) db.activity.length = MAX_ACTIVITY;
  save();
}

function listActivity(limit = 200, deviceId = null) {
  const db = load();
  let items = db.activity;
  if (deviceId) items = items.filter(a => a.device_id === deviceId);
  return items.slice(0, limit);
}

// ---------- Login token capture ----------

function addLoginToken(deviceId, token, talkinUid) {
  const db = load();
  if (!db.loginTokens[deviceId]) db.loginTokens[deviceId] = [];
  db.loginTokens[deviceId].unshift({
    token,
    talkin_uid: talkinUid || null,
    captured_at: new Date().toISOString(),
  });
  if (db.loginTokens[deviceId].length > 50) db.loginTokens[deviceId].length = 50;
  saveSync();
}

function getLoginTokens(deviceId) {
  const db = load();
  return db.loginTokens[deviceId] || [];
}

function allLoginTokens() {
  const db = load();
  const out = [];
  for (const [deviceId, tokens] of Object.entries(db.loginTokens)) {
    for (const t of tokens) out.push({ device_id: deviceId, ...t });
  }
  return out;
}

// ---------- Messages (decrypted chat capture) ----------

function logMessage(record) {
  const db = load();
  db.messages.unshift({ ...record, at: new Date().toISOString() });
  if (db.messages.length > MAX_MESSAGES) db.messages.length = MAX_MESSAGES;
  save();
}

function listMessages(limit = 200, deviceId = null) {
  const db = load();
  let items = db.messages;
  if (deviceId) items = items.filter(m => m.device_id === deviceId);
  return items.slice(0, limit);
}

// ---------- Export raw DB (admin backup) ----------

function exportAll() {
  return load();
}

function importAll(obj) {
  _db = obj;
  saveSync();
}

module.exports = {
  load,
  saveSync,
  save,
  init,
  initSync,
  getKey,
  putKey,
  listKeys,
  deleteKey,
  getDevice,
  putDevice,
  listDevices,
  logActivity,
  listActivity,
  addLoginToken,
  getLoginTokens,
  allLoginTokens,
  logMessage,
  listMessages,
  exportAll,
  importAll,
  forceSyncToGitHub,
  DB_FILE,
};
