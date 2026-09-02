# Talkin Pro — Deployment Guide (Hindi + English)

## Aapko kya karna hai — step by step

Is guide mein 3 cheezein setup karni hain:
1. **Render server** deploy karna (main code de chuka hoon)
2. **Firebase** private key download karna
3. **Keys generate** karna

Baad mein main aapke values use karke APK banaunga.

---

## STEP 1: Render pe server deploy karna

### 1.1 Code ko GitHub pe daalo

Sabse pehle, `render_server` folder ko GitHub pe push karo. Agar aapka GitHub account hai:

1. GitHub pe ek naya repository banao ( naam rakh lo `talkinpro-server`)
2. `render_server` folder ke andar jaao
3. Git initialize karo aur push karo:
```bash
cd render_server
git init
git add .
git commit -m "Talkin Pro server"
git branch -M main
git remote add origin https://github.com/AAPKA_USERNAME/talkinpro-server.git
git push -u origin main
```

### 1.2 Render pe deploy karo

1. https://dashboard.render.com pe jao (aapka account pehle se bana hua hai)
2. **"New +"** → **"Web Service"** click karo
3. **"Build and deploy from a Git repository"** select karo
4. Apna GitHub repository connect karo (`talkinpro-server`)
5. Settings fill karo:
   - **Name**: `talkinpro-server`
   - **Runtime**: `Node` (auto-detect ho jayega)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
6. **"Advanced"** section kholo aur Environment Variables add karo (STEP 3 se values)

### 1.3 Environment Variables add karo

Render dashboard mein **Environment** tab mein jaao aur ye variables add karo:

```
APP_LATEST_VERSION=1.0.0
APP_MIN_VERSION=1.0.0
FREE_ENTITLEMENT=true
KEY_PREFIX=pro_

AGORA_APP_ID=84c95fd2496e403ab14776f5c74a08ca
AGORA_APP_CERTIFICATE=efd9bd2ff054416caf3bcfcfcd1c3c2a

TENCENT_SDK_APP_ID=1721000587
```

Ab STEP 2 aur STEP 3 ke values bhi yahan add karoge.

7. **"Create Web Service"** click karo
8. Deploy hone ka wait karo (2-3 minutes)
9. Aapko ek URL milega jaise `https://talkinpro-server.onrender.com`
10. Browser mein `https://talkinpro-server.onrender.com/health` kholo — agar `{"status":"healthy"}` dikhe to server chal raha hai! ✅

---

## STEP 2: Firebase private key download karna

1. https://console.firebase.google.com pe jao
2. **"Talkin Pro"** project kholo
3. **Project Settings** (gear icon ⚙️ top left) → **"Service accounts"** tab
4. **"Generate new private key"** button click karo
5. Ek JSON file download hogi (jaise `talkin-pro-asy404-firebase-adminsdk-xxxxx.json`)
6. Is file ko text editor mein kholo (Notepad / VS Code)
7. **POORA JSON content** copy karo (sab kuch — `{` se `}` tak)

Ab Render ke Environment Variables mein jao aur add karo:
```
FIREBASE_CREDENTIALS=<yahan poora JSON paste karo, single line mein>
```

> ⚠️ **Important**: JSON ko ek hi line mein paste karo. Agar Render pe single line mein nahi ho raha, to JSON file ko Render pe "Secret File" ke tarah upload karo aur `FIREBASE_CREDENTIALS_PATH=/etc/secrets/firebase-key.json` set karo.

---

## STEP 3: Keys generate karna

Ye sabse important step hai — isse aapki license/crypto keys banengi.

### Option A: Local pe generate karo (recommended)

Agar aapke computer/laptop pe Node.js installed hai:

```bash
cd render_server
npm install
npm run keygen
```

Ye 4 values output karega:
```
APP_SIGNING_SECRET=8deb16b5...
ENTITLEMENT_PUBLIC_KEY_HEX=ff2f8a41...
ENTITLEMENT_PRIVATE_KEY_HEX=8dd2f1ff...
TENCENT_MSG_KEY=cfe996c3...
```

### Option B: Main generate karke de dunga

Maine already keys generate kar li hain (test ke liye). Ye rahi:

```
APP_SIGNING_SECRET=8deb16b5e6ea641ae37e3b48e63328acdd7e073de2f13c487204eb5f507a4834
ENTITLEMENT_PUBLIC_KEY_HEX=ff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83
ENTITLEMENT_PRIVATE_KEY_HEX=8dd2f1ff335a5e8266272be69b47ba82956d8ab0c368493a063b70574914c0feff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83
TENCENT_MSG_KEY=cfe996c39df1063cee7111e3aab043e1c295dede59d74f4639df5b279045c816
```

> Aap chahe to ye use kar sakte ho, ya apne generate kar lo (zyada secure). Dono chalega.

### Keys Render pe add karo

Environment Variables mein ye 4 add karo:
```
APP_SIGNING_SECRET=<value>
ENTITLEMENT_PUBLIC_KEY_HEX=<value>
ENTITLEMENT_PRIVATE_KEY_HEX=<value>
TENCENT_MSG_KEY=<value>
```

Save karo aur Render service ko **manual deploy** karo (dashboard mein "Deploy latest commit" button).

---

## STEP 4: Server test karna

Deploy hone ke baad, browser mein ye URLs kholo aur check karo:

| URL | Expected result |
|-----|----------------|
| `https://YOUR-URL.onrender.com/health` | `{"status":"healthy",...}` |
| `https://YOUR-URL.onrender.com/v1/sys/status` | `{"status":"online",...}` |
| `https://YOUR-URL.onrender.com/v1/sys/build?current=1.0.0` | `"up_to_date": true` |
| `https://YOUR-URL.onrender.com/v1/session/entitlement?device_id=test` | All features `true` |

Sab sahi dikh raha hai to server ready hai! 🎉

---

## STEP 5: Mujhe ye values bhejo

Server deploy hone ke baad, mujhe ye 3 cheezein bhejo:

1. **Aapka Render URL** (jaise `https://talkinpro-server.onrender.com`)
2. **APP_SIGNING_SECRET** (jo generate hua)
3. **ENTITLEMENT_PUBLIC_KEY_HEX** (jo generate hua)

> Baaki sab (Agora, Firebase, package name) mere paas pehle se hai.

Main ye values APK mein daal dunga, APK build + sign karunga, aur aapko final signed APK de dunga.

---

## FUTURE mein update kaise push karna hai (★ Aapka main requirement)

Jab future mein aapko naya version release karna ho:

1. Naya APK banao (ya mujhe bolo banane ke liye)
2. Naya APK apne website/Firebase Hosting pe upload karo
3. Render dashboard mein jao → Environment → `APP_LATEST_VERSION` ko bump karo (jaise `1.0.0` → `1.1.0`)
4. Save karo → Render auto-redeploy ho jayega

**Result**: Sab users ko next launch pe update prompt dikhega → wo aapki website se download karenge. **Play Store kabhi involve nahi hoga.** ✅

Agar FORCE update chahiye (sabko update karwana): `APP_MIN_VERSION` ko bhi bump kar do. Phir purana version walo ko app block ho jayega jab tak update na karein.

---

## Optional: Firebase Hosting pe APK host karna

1. Firebase Console → **Hosting** → Get started
2. Firebase CLI install karo: `npm install -g firebase-tools`
3. Login: `firebase login`
4. Init: `firebase init hosting` (project: talkin-pro-asy404)
5. Ek `download` folder banao aur usme APK rakho
6. Deploy: `firebase deploy --only hosting`
7. URL milega: `https://talkin-pro-asy404.web.app/download/talkinpro.apk`
8. Render mein `APP_DOWNLOAD_URL` ko ye URL pe set karo

---

## Troubleshooting

### Server deploy fail ho raha hai?
- Check Render logs (dashboard → "Logs" tab)
- Ensure `package.json` mein `"start": "node src/server.js"` hai
- Node version 18+ chahiye (Render auto-detect karta hai)

### Endpoints kaam nahi kar rahe?
- `https://YOUR-URL.onrender.com/` kholo — saare endpoints list honge
- `https://YOUR-URL.onrender.com/health` check karo

### Firebase error?
- `FIREBASE_CREDENTIALS` JSON valid hai ya nahi check karo
- Server bina Firebase ke bhi chalega (push notifications sirf band honge)

### Agora token nahi ban raha?
- `AGORA_APP_ID` aur `AGORA_APP_CERTIFICATE` Render env mein set hain ya nahi check karo
- Agora Console mein App Certificate enabled hai ya nahi check karo
