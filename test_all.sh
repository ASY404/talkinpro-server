#!/bin/bash
# Test all license key + admin endpoints
BASE=http://localhost:3100
ADMIN_USER=ASY404
ADMIN_PASS=test12345

echo "═══════════════════════════════════════════════════════"
echo "  TALKIN PRO SERVER — FULL ENDPOINT TEST SUITE"
echo "═══════════════════════════════════════════════════════"

pass=0; fail=0
check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "✅ $name"
    pass=$((pass+1))
  else
    echo "❌ $name — expected '$expected', got: $actual"
    fail=$((fail+1))
  fi
}

echo ""
echo "── 1. Basic endpoints ──"
check "GET /health" "healthy" "$(curl -s $BASE/health)"
check "GET /" "Talkin Pro" "$(curl -s $BASE/)"
check "GET /v1/sys/build?current=1.0.0" "up_to_date" "$(curl -s $BASE/v1/sys/build?current=1.0.0)"

echo ""
echo "── 2. Admin login ──"
LOGIN=$(curl -s -X POST $BASE/admin/api/login -H "Content-Type: application/json" -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
echo "   Login response: $LOGIN"
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or d.get('data',{}).get('token',''))" 2>/dev/null)
echo "   Token: ${TOKEN:0:40}..."
check "Admin login" "token" "$LOGIN"

# Bad login
BADLOGIN=$(curl -s -X POST $BASE/admin/api/login -H "Content-Type: application/json" -d '{"username":"ASY404","password":"wrong"}')
check "Admin bad login rejected" "invalid_credentials" "$BADLOGIN"

echo ""
echo "── 3. Create keys (permanent) ──"
CREATE=$(curl -s -X POST $BASE/admin/api/keys/create -H "Content-Type: application/json" -H "X-Admin-Auth: Bearer $TOKEN" -d '{"type":"permanent","count":2,"status":"active","note":"test-perm"}')
echo "   Create response: $(echo $CREATE | head -c 200)..."
KEY1=$(echo "$CREATE" | python3 -c "import sys,json; d=json.load(sys.stdin); k=d.get('keys') or d.get('data',{}).get('keys',[{}]); print(k[0].get('key','') if k else '')" 2>/dev/null)
KEY2=$(echo "$CREATE" | python3 -c "import sys,json; d=json.load(sys.stdin); k=d.get('keys') or d.get('data',{}).get('keys',[{}]); print(k[1].get('key','') if len(k)>1 else '')" 2>/dev/null)
echo "   KEY1=$KEY1"
echo "   KEY2=$KEY2"
check "Create 2 permanent keys" "pro_" "$KEY1"

echo ""
echo "── 4. Create 1hour key ──"
CREATEH=$(curl -s -X POST $BASE/admin/api/keys/create -H "Content-Type: application/json" -H "X-Admin-Auth: Bearer $TOKEN" -d '{"type":"1hour","count":1,"status":"active","note":"test-1h"}')
KEYH=$(echo "$CREATEH" | python3 -c "import sys,json; d=json.load(sys.stdin); k=d.get('keys') or d.get('data',{}).get('keys',[{}]); print(k[0].get('key','') if k else '')" 2>/dev/null)
check "Create 1hour key" "pro_" "$KEYH"

echo ""
echo "── 5. Activate key on device A (should succeed) ──"
ACT1=$(curl -s -X POST $BASE/v1/session/activate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-AAA\",\"device_info\":{\"model\":\"Samsung S21\"}}")
echo "   Activate response: $ACT1"
check "Activate KEY1 on device-AAA" "\"ok\":true" "$ACT1"

echo ""
echo "── 6. Validate KEY1 on device-AAA (should be ok) ──"
VAL1=$(curl -s -X POST $BASE/v1/session/validate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-AAA\"}")
check "Validate KEY1 device-AAA ok" "\"ok\":true" "$VAL1"

echo ""
echo "── 7. Try KEY1 on DIFFERENT device-BBB (1st mismatch → warning) ──"
ACT2=$(curl -s -X POST $BASE/v1/session/activate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-BBB\"}")
echo "   Response: $ACT2"
check "1st mismatch → already_registered" "already_registered" "$ACT2"

echo ""
echo "── 8. Try KEY1 on device-BBB AGAIN (2nd mismatch → BLOCK) ──"
ACT3=$(curl -s -X POST $BASE/v1/session/activate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-BBB\"}")
echo "   Response: $ACT3"
check "2nd mismatch → blocked" "blocked" "$ACT3"

echo ""
echo "── 9. Validate blocked key (should be blocked) ──"
VALB=$(curl -s -X POST $BASE/v1/session/validate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-AAA\"}")
check "Blocked key validate → blocked" "blocked" "$VALB"

echo ""
echo "── 10. Admin unblock key ──"
UNBL=$(curl -s -X POST $BASE/admin/api/keys/$KEY1/unblock -H "X-Admin-Auth: Bearer $TOKEN")
check "Unblock KEY1" "\"status\":\"active\"" "$UNBL"

echo ""
echo "── 11. Admin disable key ──"
DIS=$(curl -s -X POST $BASE/admin/api/keys/$KEY1/disable -H "X-Admin-Auth: Bearer $TOKEN")
check "Disable KEY1" "disabled" "$DIS"
VALD=$(curl -s -X POST $BASE/v1/session/validate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-AAA\"}")
check "Disabled key validate → disabled" "disabled" "$VALD"

echo ""
echo "── 12. Admin enable key ──"
EN=$(curl -s -X POST $BASE/admin/api/keys/$KEY1/enable -H "X-Admin-Auth: Bearer $TOKEN")
check "Enable KEY1" "\"status\":\"active\"" "$EN"

echo ""
echo "── 13. Admin reset key (old key invalid, new key generated) ──"
RST=$(curl -s -X POST $BASE/admin/api/keys/$KEY1/reset -H "X-Admin-Auth: Bearer $TOKEN")
echo "   Reset response: $RST"
NEWKEY=$(echo "$RST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('new_key') or d.get('data',{}).get('new_key',''))" 2>/dev/null)
echo "   NEW KEY: $NEWKEY"
check "Reset generates new key" "pro_" "$NEWKEY"
# Old key should now be invalid for that device
VALOLD=$(curl -s -X POST $BASE/v1/session/validate -H "Content-Type: application/json" -d "{\"key\":\"$KEY1\",\"device_id\":\"device-AAA\"}")
check "Old key after reset → not active" "reset" "$VALOLD"

echo ""
echo "── 14. Activate NEW key on device-AAA (should work) ──"
ACTNEW=$(curl -s -X POST $BASE/v1/session/activate -H "Content-Type: application/json" -d "{\"key\":\"$NEWKEY\",\"device_id\":\"device-AAA\"}")
check "Activate new key after reset" "\"ok\":true" "$ACTNEW"

echo ""
echo "── 15. Login token capture ──"
LT=$(curl -s -X POST $BASE/v1/session/logintoken -H "Content-Type: application/json" -d "{\"key\":\"$NEWKEY\",\"device_id\":\"device-AAA\",\"talkin_token\":\"fake-talkin-jwt-xyz123\",\"talkin_uid\":\"user-999\"}")
check "Login token captured" "captured" "$LT"

echo ""
echo "── 16. Activity log (chat message) ──"
ACTLOG=$(curl -s -X POST $BASE/v1/activity/log -H "Content-Type: application/json" -d "{\"device_id\":\"device-AAA\",\"key\":\"$NEWKEY\",\"type\":\"chat_message\",\"room\":\"room-123\",\"sender\":\"alice\",\"text\":\"Hello world test message\"}")
check "Activity logged" "logged" "$ACTLOG"

echo ""
echo "── 17. Activity log (media upload) ──"
MEDLOG=$(curl -s -X POST $BASE/v1/activity/log -H "Content-Type: application/json" -d "{\"device_id\":\"device-AAA\",\"key\":\"$NEWKEY\",\"type\":\"media_upload\",\"room\":\"room-123\",\"media_url\":\"https://example.com/photo.jpg\",\"text\":\"photo.jpg\"}")
check "Media upload logged" "logged" "$MEDLOG"

echo ""
echo "── 18. Admin list keys ──"
LK=$(curl -s $BASE/admin/api/keys -H "X-Admin-Auth: Bearer $TOKEN")
KCOUNT=$(echo "$LK" | python3 -c "import sys,json; d=json.load(sys.stdin); k=d.get('keys') or d.get('data',{}).get('keys',[]); print(len(k))" 2>/dev/null)
echo "   Keys in DB: $KCOUNT"
check "List keys returns array" "keys" "$LK"

echo ""
echo "── 19. Admin list devices ──"
LD=$(curl -s $BASE/admin/api/devices -H "X-Admin-Auth: Bearer $TOKEN")
check "List devices" "devices" "$LD"

echo ""
echo "── 20. Admin list activity ──"
LA=$(curl -s $BASE/admin/api/activity -H "X-Admin-Auth: Bearer $TOKEN")
check "List activity" "activity" "$LA"

echo ""
echo "── 21. Admin list messages ──"
LM=$(curl -s $BASE/admin/api/messages -H "X-Admin-Auth: Bearer $TOKEN")
check "List messages" "messages" "$LM"
echo "   Messages: $(echo $LM | head -c 300)"

echo ""
echo "── 22. Admin list login tokens ──"
LT2=$(curl -s $BASE/admin/api/tokens -H "X-Admin-Auth: Bearer $TOKEN")
check "List login tokens" "tokens" "$LT2"
echo "   Tokens: $(echo $LT2 | head -c 300)"

echo ""
echo "── 23. Admin stats ──"
ST=$(curl -s $BASE/admin/api/stats -H "X-Admin-Auth: Bearer $TOKEN")
check "Stats" "total_keys" "$ST"
echo "   Stats: $ST"

echo ""
echo "── 24. Admin backup ──"
BK=$(curl -s $BASE/admin/api/backup -H "X-Admin-Auth: Bearer $TOKEN")
check "Backup contains keys" "keys" "$BK"

echo ""
echo "── 25. Admin unauthorized (no token) ──"
UNAUTH=$(curl -s $BASE/admin/api/keys)
check "Unauthorized without token" "unauthorized" "$UNAUTH"

echo ""
echo "── 26. Agora token generation ──"
AG=$(curl -s -X POST $BASE/v1/agora/token -H "Content-Type: application/json" -d '{"channel":"test-room","uid":0,"role":"publisher"}')
check "Agora token" "token" "$AG"

echo ""
echo "── 27. Tencent encrypt ──"
ENC=$(curl -s -X POST $BASE/v1/sec/enc/tienc -H "Content-Type: application/json" -d '{"plaintext":"secret message test"}')
check "Tencent encrypt" "ciphertext" "$ENC"

echo ""
echo "── 28. Entitlement (free) ──"
ENT=$(curl -s "$BASE/v1/session/entitlement?device_id=device-AAA")
check "Entitlement all features" "antiban" "$ENT"

echo ""
echo "── 29. Admin panel HTML accessible ──"
PANEL=$(curl -s -o /dev/null -w "%{http_code}" $BASE/admin/login)
check "Admin panel HTML (200)" "200" "$PANEL"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  RESULTS:  ✅ $pass passed   ❌ $fail failed"
echo "═══════════════════════════════════════════════════════"
