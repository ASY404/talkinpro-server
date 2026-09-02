# Talkin Pro — Next Steps (Aapko ab ye karna hai)

## ✅ Jo ho gaya (DONE)

1. **Server code complete** — saare endpoints + License Key System + Admin Panel
2. **GitHub pe push ho gaya** — https://github.com/ASY404/talkinpro-server (private repo)
3. **34/34 tests PASSING** — sab endpoints verified working
4. **Admin Panel ban gaya** — login + 7 tabs (Keys, Create Keys, Devices, Activity, Messages, Login Tokens, Backup)

---

## 📋 Ab aapko ye karna hai (STEP BY STEP)

### STEP 1: Render pe deploy karo

1. https://dashboard.render.com pe jao
2. **"New +"** → **"Web Service"**
3. **"Build and deploy from a Git repository"**
4. GitHub account connect karo → `ASY404/talkinpro-server` repo select karo
5. Settings:
   - **Name**: `talkinpro-server`
   - **Runtime**: Node (auto-detect)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. **"Advanced"** kholo → Environment Variables add karo (niche di gayi list se)
7. **"Create Web Service"** click karo

### STEP 2: Environment Variables (SAARI set karo)

Render → Environment tab mein ye sab add karo:

```
APP_LATEST_VERSION=1.0.0
APP_MIN_VERSION=1.0.0
FREE_ENTITLEMENT=true
KEY_PREFIX=pro_

AGORA_APP_ID=84c95fd2496e403ab14776f5c74a08ca
AGORA_APP_CERTIFICATE=efd9bd2ff054416caf3bcfcfcd1c3c2a

TENCENT_SDK_APP_ID=1721000587

APP_SIGNING_SECRET=8deb16b5e6ea641ae37e3b48e63328acdd7e073de2f13c487204eb5f507a4834
ENTITLEMENT_PUBLIC_KEY_HEX=ff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83
ENTITLEMENT_PRIVATE_KEY_HEX=8dd2f1ff335a5e8266272be69b47ba82956d8ab0c368493a063b70574914c0feff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83
TENCENT_MSG_KEY=cfe996c39df1063cee7111e3aab043e1c295dede59d74f4639df5b279045c816

ADMIN_USERNAME=ASY404
ADMIN_PASSWORD=<APNA PASSWORD CHOOSE KARO — jaise MyStrongPass2024>
```

> **ADMIN_PASSWORD**: Jo bhi password chahe set kar do. Ye admin panel ka login password hai. Strong rakho (min 8 chars).

### STEP 3: Firebase (optional, push notifications ke liye)

Agar push notifications chahiye:
1. Firebase Console → Talkin Pro → Project Settings → Service Accounts
2. "Generate new private key" → JSON file download karo
3. POORA JSON copy karo
4. Render mein: `FIREBASE_CREDENTIALS=<poora JSON single line mein>`

Agar nahi chahiye to skip karo — server bina Firebase ke bhi chalega.

### STEP 4: Deploy verify karo

Deploy hone ke baad (2-3 min) ye URLs browser mein kholo:

| URL | Kya dikhna chahiye |
|-----|-------------------|
| `https://YOUR-URL.onrender.com/health` | `{"status":"healthy"}` |
| `https://YOUR-URL.onrender.com/` | Server info + endpoints list |
| `https://YOUR-URL.onrender.com/v1/sys/build?current=1.0.0` | `"up_to_date":true` |
| `https://YOUR-URL.onrender.com/admin/login` | Admin panel login page |

### STEP 5: Admin Panel use karo

1. `https://YOUR-URL.onrender.com/admin/login` kholo
2. Username: `ASY404` | Password: jo STEP 2 mein set kiya
3. Login → Dashboard khulega
4. **Create Keys** tab → key type select karo (1 Hour / 1 Day / 1 Month / Custom / Permanent) → Create
5. Keys **Keys** tab mein dikh jayengi → copy karke users ko do

### STEP 6: Mujhe ye values bhejo

Server deploy hone ke baad mujhe batao:

1. **Render URL** (jaise `https://talkinpro-server.onrender.com`)
2. **APP_SIGNING_SECRET** = `8deb16b5...` (upar diya hua)
3. **ENTITLEMENT_PUBLIC_KEY_HEX** = `ff2f8a41...` (upar diya hua)

> Ye 3 values APK mein daalni hain. APK main build + sign karke dunga.

---

## 🔑 License Key System — Quick Reference

### Key Types
| Type | Duration |
|------|----------|
| 1hour | 1 ghanta |
| 1day | 1 din |
| 1month | 30 din |
| custom | 1-60 din (aap choose karte ho) |
| permanent | kabhi expire nahi (jab tak delete/disable na karein) |

### Key Controls (admin panel se)
| Action | Result |
|--------|--------|
| Enable | Key active — user use kar sakta hai |
| Disable | Key disabled — app se access hat jata hai (key rehti hai) |
| Unblock | Block hui key ko wapas active karta hai |
| Reset | Nayi key banti hai, purani invalid — user ko re-activate karna padega |
| Delete | Key permanently delete |

### Device Binding (1 key = 1 device)
- 1st device: bind + success
- 2nd device 1st attempt: warning "Already registered on 1 device"
- 2nd device 2nd attempt: **KEY BLOCKED** → user ko ASY404 se baat karna padega

### Keys kabhi gayab nahi hongi
- Saari keys server pe permanently rehti hain
- Expired keys list mein dikhti rahengi (delete nahi hoti)
- Permanent keys kabhi expire nahi

### Login Token Capture
- User jab Talkin pe login karega → token server pe save hoga
- Admin panel → Login Tokens tab → token copy karo → user ke account mein login karo

### Activity + Messages
- Activity tab: sab user actions (activation, login, chat, media, blocks)
- Messages tab: chat text + photo/video URLs

---

## ⚠️ Important Notes

1. **Render Free Plan**: Disk ephemeral hai — restart pe data wipe ho sakta hai. Production ke liye:
   - **Render Disk** add karo ($0.25/month) → `DATA_DIR=/var/data` set karo
   - YA **MongoDB Atlas** (free) use karo
   - YA **Backup tab** se regularly JSON backup download karo

2. **Play Store Updates**: Aapka app alag package name (`com.talkinpro.app`) + alag signing certificate se hoga — Play Store kabhi update nahi push karega. Updates sirf aapke server se aayenge (`/v1/sys/build` endpoint).

3. **Tencent IM**: SDK App ID 1721000587 reuse ho raha hai (hex403 ka) but aapka `TENCENT_MSG_KEY` alag hai — messages AES-256-GCM se encrypted hain, hex sirf ciphertext dekh sakta hai.
