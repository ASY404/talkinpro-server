# GitHub + Render Complete Setup Guide
## Talkin Pro Backend Server — Step-by-Step (Hindi + English)

Is guide me hum cover karenge:
1. GitHub account banana (agar nahi hai)
2. Naya private repository banana
3. Server code GitHub pe upload karna (2 tareeke — AURdonfused mat hona, dono me se koi bhi tareeka use karo)
4. Render ko GitHub se connect karna
5. Environment variables (keys) Render pe daalna
6. Deploy hona aur verify karna

---

## STEP 1 — GitHub Account Banao (agar pehle se nahi hai)

1. Browser me kholo: **https://github.com/signup**
2. Email daalo (jo use karte ho) → **Continue**
3. Password daalo (strong — koi na bhule) → **Continue**
4. Username choose karo (jaise `talkinpro` ya kuch bhi) → **Continue**
5. Email pe verification code aayega → wo daalo
6. "Skip personalization" ya jaisa bhi aage badho

Agar account pehle se hai to **https://github.com/login** pe login kar lo.

---

## STEP 2 — Naya PRIVATE Repository Banao

Kyun **Private**? Kyunki isme tumhari signing keys, Agora certificate, Firebase keys ka reference hoga. Public mat banao warna koi bhi dekh sakta hai. (Render free plan ke saath private repo bhi chalta hai.)

1. Login ke baad **https://github.com/new** kholo
2. Form bharo:
   - **Repository name:** `talkinpro-server`
   - **Description:** `Talkin Pro backend` (optional)
   - **Visibility:** ⚫ **Private** (IMPORTANT — Private select karo)
   - **Initialize this repository with:** sab kuch **UN-tick** karo (README, .gitignore, license — kuch nahi chahiye, hum apna code daalenge)
3. Niche **Create repository** button dabao

Ab tumhe ek page milega jisme commands likhe honge — usko khaas dhyan se dekhna, usme tumhara repo URL hoga jaisa:

```
https://github.com/tumhara-username/talkinpro-server.git
```

Is URL ko copy kar lo — baad me kaam aayega.

---

## STEP 3 — Server Code GitHub Pe Upload Karo

Do tareeke hain. Tum **koi bhi ek** use kar sakte ho.

### 🟢 TARIQA A — Easy Way (GitHub Website pe Drag & Drop)

Ye sabse simple hai. Computer pe koi software install nahi karna.

1. `render_server.zip` file ko apne computer pe download kar lo (maine di hai)
2. Zip ko **extract/unzip** kar lo — ek folder banega jisme ye files hongi:
   ```
   render_server/
     ├── .env.example
     ├── .gitignore
     ├── DEPLOYMENT_GUIDE.md
     ├── README.md
     ├── GITHUB_SETUP.md
     ├── package.json
     ├── package-lock.json
     ├── render.yaml
     └── src/
           ├── server.js
           ├── config.js
           ├── crypto-utils.js
           ├── agora-token.js
           ├── firebase-init.js
           └── keygen.js
   ```
3. GitHub pe apni repo (`talkinpro-server`) kholo
4. **Important:** GitHub ki web interface me **hidden files (.env.example, .gitignore)** default me nahi dikhte drag-drop me. Isliye ye karo:
   - Repo page pe **"uploading an existing file"** link pe click karo (ya `Add file → Upload files`)
   - Folder khul jayega
   - **Drag & drop** kar do `src` folder aur visible files (`package.json`, `README.md`, etc.) ko
   - Hidden files (`.env.example`, `.gitignore`) ke liye: **"Add file → Create new file"** karo, naam me `.gitignore` likho, content paste karo (maine neeche diya hai), commit karo. `.env.example` ke liye bhi same.
5. Niche **Commit changes** section me message likho: `Initial server code`
6. **Commit changes** button dabao

**Hidden files content (agar manually banana pade):**

**.gitignore** (filename must be exactly `.gitignore`):
```
node_modules/
.env
keys/
*.key
firebase-key*.json
.DS_Store
npm-debug.log*
```

**.env.example** ka content tumhare zip me already hai — usko copy karke `Add file → Create new file` → naam `.env.example` rakh kar paste kar do.

> ⚠️ **DHYAN:** `.env.example` upload hona zaroori hai (ye sirf template hai, real keys nahi hain). Lekin `.env` (bina example wala) **KABHI upload mat karna** — wo private keys hoti hain. `.gitignore` already ise block karta hai.

---

### 🟢 TARIQA B — Developer Way (Git CLI se push)

Agar tumhare computer pe Git installed hai (Windows me **Git Bash**, Mac/Linux me terminal), to ye sabse fast hai.

1. `render_server.zip` download + unzip karo
2. Terminal / Git Bash kholo aur us folder me jao jahan unzip hua:
   ```bash
   cd path/to/render_server
   ```
3. Git init aur files add karo:
   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "Initial server code"
   ```
4. Ab apni repo URL lagao (jo STEP 2 me mili thi):
   ```bash
   git remote add origin https://github.com/tumhara-username/talkinpro-server.git
   git push -u origin main
   ```
5. Pehli baar push karne pe GitHub username + password maangega:
   - **Username:** apna GitHub username
   - **Password:** apne GitHub password **NAHI** — ye **Personal Access Token** chahiye (GitHub ne password support band kar diya). Token banana neeche "Bonus" section me diya hai.
6. Push hone ke baad GitHub pe refresh karo — saari files dikhengi.

---

## STEP 4 — Render Ko GitHub Se Connect Karo

1. **https://render.com** pe login karo (jahan tumne account banaya tha)
2. Dashboard pe **New +** → **Web Service** dabao
3. Ab 2 options milenge — **"Deploy an existing app from a git repository"** select karo
4. **Connect a repository** me **GitHub** pe click karo
5. Pehli baar hoga to Render GitHub permissions maangega:
   - **"Configure GitHub"** dabao
   - GitHub pe allow karo — sirf apni repo (`talkinpro-server`) select karne ka option dunga (ya "All repositories" bhi kar sakte ho)
   - **Install** dabao
6. Wapas Render pe aaoge — list me `talkinpro-server` dikhega → uske aage **Connect** dabao

---

## STEP 5 — Render Service Settings Bharo

Ab Render ek form kholega. Ye values bharo:

| Field | Value |
|---|---|
| **Name** | `talkinpro-server` (ya jo bhi chaho) |
| **Language** | `Node` (auto-detect ho jayega, warna select karo) |
| **Branch** | `main` |
| **Root Directory** | (khali chodo) |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (baad me upgrade kar sakte ho) |

Niche **Advanced** section khul jayega — wahan Environment Variables daalne hain (STEP 6).

Pehle save nahi karna — pehle env vars daalo.

---

## STEP 6 — Environment Variables (Keys) Render Pe Daalo

**Advanced** section me **"Add Environment Variable"** button hai. Ek-ek karke ye sab add karo. Value column me neeche di gayi values paste karo (ye maine tumhare liye pre-generate ki hain).

### 6.1 App & Update Config

| Key | Value |
|---|---|
| `PUBLIC_URL` | (abhi khali chodo — deploy hone ke baad Render URL milega, phir update karenge) |
| `APP_LATEST_VERSION` | `1.0.0` |
| `APP_MIN_VERSION` | `1.0.0` |
| `APP_DOWNLOAD_URL` | (baad me — jab APK Firebase Hosting pe upload hogi) |
| `APP_DISCORD_URL` | (optional, khali chodo) |
| `APP_CHANGELOG` | `First release of Talkin Pro` |

### 6.2 Signing Keys (PRE-GENERATED — ye copy paste karo)

| Key | Value |
|---|---|
| `APP_SIGNING_SECRET` | `8deb16b5e6ea641ae37e3b48e63328acdd7e073de2f13c487204eb5f507a4834` |
| `ENTITLEMENT_PUBLIC_KEY_HEX` | `ff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83` |
| `ENTITLEMENT_PRIVATE_KEY_HEX` | `8dd2f1ff335a5e8266272be69b47ba82956d8ab0c368493a063b70574914c0feff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83` |
| `TENCENT_MSG_KEY` | `cfe996c39df1063cee7111e3aab043e1c295dede59d74f4639df5b279045c816` |
| `KEY_PREFIX` | `fool403_` |

### 6.3 Entitlement Mode

| Key | Value |
|---|---|
| `FREE_ENTITLEMENT` | `true` |

(Ye `true` rakhne se saare 12 features — prank, boost, antidelete, antimicmute, antimicremove, antivoiceroomleave, voiceeffect, soundbox, imgprank, stickerprank, musicbot, antiban — free me ON rahenge bina kisi license key ke.)

### 6.4 Agora (tumhara apna account)

| Key | Value |
|---|---|
| `AGORA_APP_ID` | `84c95fd2496e403ab14776f5c74a08ca` |
| `AGORA_APP_CERTIFICATE` | `efd9bd2ff054416caf3bcfcfcd1c3c2a` |

### 6.5 Tencent IM (existing SDK App ID reuse)

| Key | Value |
|---|---|
| `TENCENT_SDK_APP_ID` | `1721000587` |

> ⚠️ **TENTATIVE IMPORTANT NOTE:** Ye Tencent SDK App ID (1721000587) original modded app me embedded hai. Hum is waqt reuse kar rahe hain kyunki Tencent ka SDK app ke native library me hard-coded hai. **Agar tum chahte ho ki 100% hex403 se alag ho jaye aur apna apna Tencent account banayein, to mujhe batao** — phir hum Tencent console pe naya app bana ke us SDK App ID ko APK me patch karenge. Abhi ke liye ye chal raha hai.

### 6.6 Firebase (optional — push notifications ke liye)

Agar push notifications chahiye to:

1. Firebase Console → **Project Settings** (gear icon) → **Service Accounts** tab
2. **"Generate new private key"** dabao → ek `.json` file download hogi
3. Us file ka **pura content** copy karo ( `{` se `}` tak)
4. Render me add karo:

| Key | Value |
|---|---|
| `FIREBASE_CREDENTIALS` | (wo pura JSON paste karo) |

Agar abhi push notifications nahi chahiye to ye skip karo — server bina iske bhi chalta hai.

---

## STEP 7 — Deploy Karo aur Verify Karo

1. Niche **Create Web Service** button dabao
2. Render build start karega — logs aate rahenge (npm install chalega, phir npm start)
3. **Pehli baar deploy hone me 2-5 minute lagte hain** (free plan)
4. Jab **"Live"** status dikh jaye aur ek URL mile (jaise `https://talkinpro-server.onrender.com`) — usko copy kar lo
5. Ab wapas **Environment** tab me jao aur `PUBLIC_URL` ki value me wo URL paste kar do → **Save Changes** (ye re-deploy karega ek baar)
6. **Verify karo** — browser me kholo:

   **Test 1 — Root:**
   ```
   https://talkinpro-server.onrender.com/
   ```
   Ye JSON dikhana chahiye jaise: `{"name":"Talkin Pro Server","status":"ok",...}`

   **Test 2 — Build / Update check:**
   ```
   https://talkinpro-server.onrender.com/v1/sys/build?current=1.0.0
   ```
   Ye dikhana chahiye:
   ```json
   {"status":"ok","code":"ok","current":"1.0.0","server_version":"1.0.0","up_to_date":true,"update_required":false}
   ```

   **Test 3 — Entitlement:**
   ```
   https://talkinpro-server.onrender.com/v1/session/entitlement?device_id=test123
   ```
   Ye dikhana chahiye saare 12 features `true` ke saath.

7. Agar teeno tests pass → **server LIVE hai!** 🎉

---

## STEP 8 — Mujhe 3 Values Bhejo

Deploy verify hone ke baad, mujhe sirf ye 3 cheezein bhej do (baaki main manage kar lunga):

1. **Render URL** (jaise `https://talkinpro-server.onrender.com`)
2. **APP_SIGNING_SECRET** → `8deb16b5e6ea641ae37e3b48e63328acdd7e073de2f13c487204eb5f507a4834`
3. **ENTITLEMENT_PUBLIC_KEY_HEX** → `ff2f8a41056ea4430ecdcb16ca96d08bd4886098836a3774d36dc82b619abf83`

(Ye dono keys maine tumhare liye pre-generate kar diye hain — ye upar STEP 6.2 me bhi hain. Sirf confirm karne ke liye bhej rahe ho, taaki main app me same daalu.)

---

## BONUS — Personal Access Token ( agar Git CLI use kar rahe ho )

GitHub ne password-based push band kar diya hai. Git CLI se push karne ke liye token chahiye:

1. GitHub login → upar right profile photo → **Settings**
2. Niche scroll → **Developer settings** (sabse niche)
3. **Personal access tokens → Tokens (classic)**
4. **Generate new token → Generate new token (classic)**
5. Form:
   - **Note:** `render-deploy` (kuch bhi)
   - **Expiration:** `90 days` (ya jo chaho)
   - **Scopes:** sirf `repo` wala box tick karo (poora repo section)
6. **Generate token** dabao
7. **Token copy kar lo** (ye dobara nahi dikhega!)
8. Ab jab git push password maange, ye token paste karo

---

## BONUS — Future Me Update Push Kaise Karo

Jab tum kabhi naya APK version release karna chaaho (jaise `1.0.0` se `1.1.0`):

1. Naya APK Firebase Hosting pe upload karo (ya kisi bhi direct download link pe)
2. Render → Environment tab me jao
3. `APP_LATEST_VERSION` ko `1.1.0` kar do
4. `APP_CHANGELOG` me naya changelog likho
5. `APP_DOWNLOAD_URL` me naye APK ka link daalo
6. **Save Changes** → server re-deploy

Ab jab users ka app khulega, wo `GET /v1/sys/build?current=1.0.0` call karega, server `latest: 1.1.0` aur `update_required: true` return karega, aur app in-app update popup dikhayega. **Play Store ka koi involvement nahi** — sirf tumhare server se update aayega. ✅

---

## TROUBLESHOOTING

**Q: Build fail ho gaya — "npm install" error?**
A: Render logs check karo. Usually `package-lock.json` corrupt hota hai. Repo se `package-lock.json` delete kar do, sirf `package.json` rakho, re-deploy.

**Q: Deploy hua but URL pe "502 Bad Gateway"?**
A: Free plan me server 15 min idle ke baad sleep ho jata hai. Pehli request 30-60 sec lagti hai wake up me. Ek baar `/` URL khol lo, thoda wait karo, phir refresh.

**Q: Entitlement me features `false` aa rahe hain?**
A: Render env me `FREE_ENTITLEMENT=true` check karo — agar nahi hai to add karo.

**Q: Agora token endpoint error?**
A: `AGORA_APP_ID` aur `AGORA_APP_CERTIFICATE` dono Render env me hona chahiye (STEP 6.4).

**Q: GitHub push me "Authentication failed"?**
A: Password nahi, Personal Access Token use karo (Bonus section dekho).

---

## SUMMARY FLOW (Quick Recap)

```
GitHub account → Private repo "talkinpro-server" → Upload code (drag-drop ya git push)
→ Render: New Web Service → Connect GitHub repo → Settings + Env vars daalo
→ Create Web Service → 2-5 min me LIVE → URL copy karke PUBLIC_URL update
→ 3 tests run karo → Mujhe 3 values bhejo → Main app build karunga
```

Bas! Itna kar lo, fir modded app build ka hisda main kar dunga. Koi step me atke to batao. 🚀
