# Talkin Pro Server

Backend server for the **Talkin Pro** modded app. Replaces hex403's `https://hex403.onrender.com` with your own server.

## What this server does

- **Version checking & updates** (`/v1/sys/build`) — controls when users see update prompts. Play Store is never involved.
- **Entitlements** (`/v1/session/entitlement`) — which premium features are enabled per device
- **License keys** (`/v1/session/key`) — activate/validate license keys
- **Tencent IM crypto** (`/v1/sec/enc/tienc`, `/v1/sec/dec/tienc`) — encrypt/decrypt chat messages
- **Agora tokens** (`/v1/agora/token`) — generate RTC tokens for voice rooms
- **Device management** (`/v1/device/issue`, `/v1/device/profiles`)
- **Push notifications** (`/v1/session/push`, `/admin/announce`) — via Firebase Cloud Messaging
- **Catalog** (`/v1/catalog/plans`, `/v1/catalog/accounts`, `/v1/catalog/feature-prices`)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Generate keys (run once)
npm run keygen
# → Copy the output into .env

# 3. Copy .env.example to .env and fill in values
cp .env.example .env

# 4. Start the server
npm start
```

## Environment Variables

See [`.env.example`](.env.example) for all variables.

Key ones:
| Variable | Description |
|----------|-------------|
| `APP_LATEST_VERSION` | Latest app version (bump to push updates) |
| `APP_MIN_VERSION` | Minimum supported version (bump to force updates) |
| `APP_DOWNLOAD_URL` | Where users download the APK |
| `APP_SIGNING_SECRET` | Request signing secret (from `npm run keygen`) |
| `ENTITLEMENT_PUBLIC_KEY_HEX` | Ed25519 public key (also goes in APK) |
| `ENTITLEMENT_PRIVATE_KEY_HEX` | Ed25519 private key (server only!) |
| `AGORA_APP_ID` | Your Agora App ID |
| `AGORA_APP_CERTIFICATE` | Your Agora App Certificate |
| `TENCENT_MSG_KEY` | AES-256 key for Tencent IM messages (from keygen) |
| `FIREBASE_CREDENTIALS` | Firebase Admin SDK JSON (for push notifications) |
| `FREE_ENTITLEMENT` | `true` = all features free for everyone |

## Deployment

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for full Render deployment instructions.

## File Structure

```
render_server/
├── src/
│   ├── server.js          # Main Express server with all endpoints
│   ├── config.js          # Loads environment variables
│   ├── crypto-utils.js    # Entitlement signing + Tencent message crypto
│   ├── agora-token.js     # Agora RTC token generation
│   ├── firebase-init.js   # Firebase Admin SDK init + push notifications
│   └── keygen.js          # Generates signing secret + Ed25519 keypair
├── package.json
├── render.yaml            # Render Blueprint config
├── .env.example           # Template for environment variables
└── DEPLOYMENT_GUIDE.md    # Step-by-step deployment guide
```

## How Updates Work (★ Key Feature)

1. App calls `GET /v1/sys/build?current=1.0.0` on launch
2. Server compares `current` with `APP_LATEST_VERSION` and `APP_MIN_VERSION`
3. If `current < min` → `update_required: true` (forced update, app blocks)
4. If `current < latest` → `update_available: true` (optional update prompt)
5. If `current >= latest` → `up_to_date: true` (no prompt)

**To push an update:**
1. Build new APK
2. Upload to `APP_DOWNLOAD_URL`
3. Bump `APP_LATEST_VERSION` in Render env vars
4. Render auto-redeploys → all users see the update on next launch

**Play Store is never involved** — the app has a unique package name + signing certificate.
