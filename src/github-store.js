/**
 * github-store.js — Persistent backup for db.json via GitHub API.
 *
 * Render free plan has ephemeral disk — db.json is wiped on every restart/deploy.
 * This module syncs db.json to a dedicated branch ('data-backup') in the GitHub repo
 * using the GitHub Contents API. On startup, it pulls the latest db.json from that
 * branch. On every save, it pushes the updated db.json back.
 *
 * Env vars needed:
 *   GITHUB_TOKEN  — GitHub PAT (repo access)
 *   GITHUB_REPO   — owner/repo format (default: ASY404/talkinpro-server)
 *   GITHUB_BRANCH — branch name (default: data-backup)
 *
 * If GITHUB_TOKEN is not set, this module is a no-op (falls back to local file only).
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'ASY404/talkinpro-server';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'data-backup';
const DB_FILE_NAME = 'db.json';

let _lastSha = null;     // SHA of the last pushed file (needed for updates)
let _pushTimer = null;
let _syncing = false;

function isConfigured() {
  return !!GITHUB_TOKEN;
}

/**
 * Make a GitHub API request.
 */
function ghRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'talkinpro-server',
    };
    if (data) headers['Content-Type'] = 'application/json';

    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${GITHUB_REPO}${path}`,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const json = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Ensure the data-backup branch exists (create from main if not).
 */
async function ensureBranch() {
  if (!isConfigured()) return;
  try {
    // Check if branch exists
    const check = await ghRequest('GET', `/branches/${GITHUB_BRANCH}`);
    if (check.status === 200) return;
    if (check.status !== 404) {
      console.error(`[github-store] Unexpected status checking branch: ${check.status}`);
      return;
    }

    // Branch doesn't exist — create it from main's HEAD
    const mainRef = await ghRequest('GET', '/git/refs/heads/main');
    if (mainRef.status !== 200) {
      console.error('[github-store] Could not get main branch ref:', mainRef.status);
      return;
    }
    const sha = mainRef.body.object.sha;
    const create = await ghRequest('POST', '/git/refs', {
      ref: `refs/heads/${GITHUB_BRANCH}`,
      sha,
    });
    if (create.status === 201) {
      console.log(`[github-store] Created branch '${GITHUB_BRANCH}' from main`);
    } else {
      console.error('[github-store] Could not create branch:', create.status, JSON.stringify(create.body));
    }
  } catch (e) {
    console.error('[github-store] ensureBranch error:', e.message);
  }
}

/**
 * Pull db.json from GitHub on startup. Returns parsed DB object or null.
 */
async function pullFromGitHub() {
  if (!isConfigured()) return null;
  try {
    const resp = await ghRequest('GET', `/contents/${DB_FILE_NAME}?ref=${GITHUB_BRANCH}`);
    if (resp.status === 404) {
      console.log('[github-store] No db.json in backup branch yet — starting fresh.');
      return null;
    }
    if (resp.status !== 200) {
      console.error(`[github-store] pullFromGitHub unexpected status: ${resp.status}`);
      return null;
    }
    // Content is base64-encoded
    const content = Buffer.from(resp.body.content, 'base64').toString('utf8');
    _lastSha = resp.body.sha;
    const db = JSON.parse(content);
    console.log(`[github-store] Pulled db.json from GitHub (SHA: ${_lastSha ? _lastSha.slice(0, 8) : 'none'}, keys: ${Object.keys(db.keys || {}).length})`);
    return db;
  } catch (e) {
    console.error('[github-store] pullFromGitHub error:', e.message);
    return null;
  }
}

/**
 * Push db.json to GitHub. Called on save (debounced).
 */
async function pushToGitHub(dbObject) {
  if (!isConfigured() || _syncing) return;
  _syncing = true;
  try {
    const content = Buffer.from(JSON.stringify(dbObject, null, 2)).toString('base64');
    const body = {
      message: `auto-sync db.json [${new Date().toISOString()}]`,
      content,
      branch: GITHUB_BRANCH,
    };
    if (_lastSha) body.sha = _lastSha;

    const resp = await ghRequest('PUT', `/contents/${DB_FILE_NAME}`, body);
    if (resp.status === 200 || resp.status === 201) {
      _lastSha = resp.body.content.sha;
      console.log(`[github-store] Pushed db.json to GitHub (keys: ${Object.keys(dbObject.keys || {}).length})`);
    } else {
      // If SHA mismatch (concurrent edit), re-pull and retry once
      if (resp.status === 409 || (resp.body && resp.body.message && resp.body.message.includes('sha'))) {
        console.log('[github-store] SHA mismatch — re-pulling and retrying...');
        const pulled = await pullFromGitHub();
        if (pulled) {
          // Merge: GitHub version wins for concurrent changes, but we keep our latest
          // For simplicity, just retry with the new SHA
          body.sha = _lastSha;
          const retry = await ghRequest('PUT', `/contents/${DB_FILE_NAME}`, body);
          if (retry.status === 200 || retry.status === 201) {
            _lastSha = retry.body.content.sha;
            console.log('[github-store] Retry succeeded.');
          }
        }
      } else {
        console.error(`[github-store] pushToGitHub failed: ${resp.status}`, JSON.stringify(resp.body).slice(0, 200));
      }
    }
  } catch (e) {
    console.error('[github-store] pushToGitHub error:', e.message);
  } finally {
    _syncing = false;
  }
}

/**
 * Debounced push — coalesce rapid saves.
 */
function schedulePush(dbObject) {
  if (!isConfigured()) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    pushToGitHub(dbObject).catch(e => console.error('[github-store] scheduled push error:', e.message));
  }, 3000); // 3 second debounce
}

module.exports = {
  isConfigured,
  ensureBranch,
  pullFromGitHub,
  pushToGitHub,
  schedulePush,
};
