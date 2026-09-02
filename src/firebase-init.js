/**
 * firebase-init.js — Initializes Firebase Admin SDK for push notifications.
 *
 * To configure:
 * 1. Go to Firebase Console → Project Settings → Service Accounts
 * 2. Click "Generate new private key" → download a JSON file
 * 3. Either:
 *    a. Paste the ENTIRE JSON content into FIREBASE_CREDENTIALS env var, OR
 *    b. On Render: upload the file as a Secret, set FIREBASE_CREDENTIALS_PATH to its path
 */

const admin = require('firebase-admin');
const config = require('./config');

let initialized = false;

function initFirebase() {
  if (initialized) return admin;
  if (admin.apps.length > 0) {
    initialized = true;
    return admin;
  }

  let credential;

  if (config.firebase.credentialsPath) {
    // Option B: file path (Render secret file)
    credential = admin.credential.cert(config.firebase.credentialsPath);
  } else if (config.firebase.credentials) {
    // Option A: JSON string in env var
    try {
      const parsed = JSON.parse(config.firebase.credentials);
      credential = admin.credential.cert(parsed);
    } catch (e) {
      throw new Error(`FIREBASE_CREDENTIALS is not valid JSON: ${e.message}`);
    }
  } else {
    throw new Error('Firebase credentials not configured (set FIREBASE_CREDENTIALS or FIREBASE_CREDENTIALS_PATH)');
  }

  admin.initializeApp({
    credential,
    projectId: 'talkin-pro-asy404',
  });

  initialized = true;
  return admin;
}

/**
 * Send a push notification to a single device token.
 */
async function sendPushNotification(token, title, body, data) {
  const message = {
    token,
    notification: { title, body },
    data: data || {},
    android: {
      notification: {
        channelId: 'talkin_pro',
        priority: 'high',
      },
    },
  };
  return admin.messaging().send(message);
}

module.exports = { initFirebase, sendPushNotification };
