#!/bin/bash

# =============================================================================
# Invoq — API Smoke Test Script
# =============================================================================
#
# Tests the full REST API lifecycle end-to-end:
#
#   1.  Health check
#   2.  Auth (missing key, bad key, valid key)
#   3.  Plans — create, read, update, deactivate, reactivate
#   4.  Checkout — build-tx, build-vault-tx
#   5.  Entitlement — check, full check
#   6.  Usage — record, read
#   7.  Subscriptions — read, cancel
#   8.  Vault — get, debit, withdraw, threshold, close
#   9.  Webhooks — create endpoint, list, delivery log, delete
#
# USAGE
# ─────
#   bash test-api.sh
#   bash test-api.sh --base-url http://localhost:3001  # custom base URL
#
# REQUIREMENTS
# ────────────
#   - invoq-api running locally (npm run dev)
#   - API_KEY env var set  OR  generated via gen-key.ts
#   - CUSTOMER_ADDRESS env var set (a funded testnet Stellar wallet)
#   - curl + jq installed

# ─── Flags ───────────────────────────────────────────────────────────────────
BASE_URL="http://localhost:3001"
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --base-url) BASE_URL="$2"; shift ;;
  esac
  shift
done

# ─── Config ──────────────────────────────────────────────────────────────────
API_KEY="${API_KEY:-}"
CUSTOMER_ADDRESS="${CUSTOMER_ADDRESS:-}"

if [ -z "$API_KEY" ]; then
  echo "Error: API_KEY not set. Run: npx tsx gen-key.ts and export API_KEY=sk_live_..."
  exit 1
fi

if [ -z "$CUSTOMER_ADDRESS" ]; then
  echo "Error: CUSTOMER_ADDRESS not set. Export a funded testnet Stellar address."
  exit 1
fi

# ─── Colours ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Counters ────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0

# ─── State (populated during run) ────────────────────────────────────────────
PLAN_ID=""
FREE_PLAN_ID=""
WEBHOOK_ENDPOINT_ID=""

# ─── Helpers ─────────────────────────────────────────────────────────────────
section() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${BOLD}  $1${NC}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

step() { echo -e "${BOLD}[$1]${NC} $2"; }
pass() { echo -e "  ${GREEN}✓ PASS${NC} — $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} — $1"; FAIL=$((FAIL + 1)); }
skip() { echo -e "  ${YELLOW}⊘ SKIP${NC} — $1"; SKIP=$((SKIP + 1)); }

# api: METHOD PATH [BODY]
# Always sends Authorization header. Returns response body.
api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $API_KEY"
  fi
}

# api_status: returns HTTP status code only
api_status() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $API_KEY"
  fi
}

assert_contains() {
  local label="$1" output="$2" expected="$3"
  if echo "$output" | grep -q "$expected"; then
    pass "$label"
  else
    fail "$label (expected '$expected' in: $output)"
  fi
}

assert_not_contains() {
  local label="$1" output="$2" expected="$3"
  if echo "$output" | grep -q "$expected"; then
    fail "$label (did NOT expect '$expected' in: $output)"
  else
    pass "$label"
  fi
}

assert_status() {
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    pass "$label (HTTP $got)"
  else
    fail "$label (expected HTTP $want, got HTTP $got)"
  fi
}

assert_json_field() {
  local label="$1" output="$2" field="$3"
  if echo "$output" | jq -e ".$field" > /dev/null 2>&1; then
    pass "$label"
  else
    fail "$label (field '$field' missing in: $output)"
  fi
}

# ─── Banner ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Invoq — API Smoke Test Suite          ║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "  Base URL:  $BASE_URL"
echo "  API Key:   ${API_KEY:0:14}..."
echo "  Customer:  $CUSTOMER_ADDRESS"
echo ""

########################################
# 1 — HEALTH
########################################

section "1 — Health check"

step "1.1" "GET /health returns 200"
OUT=$(curl -s "$BASE_URL/health")
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
assert_status "health returns 200" "$STATUS" "200"
assert_contains "health has status ok" "$OUT" '"status":"ok"'
assert_json_field "health has ts field" "$OUT" "ts"

########################################
# 2 — AUTH
########################################

section "2 — Authentication"

step "2.1" "Request with no key → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/plans/1")
assert_status "no key → 401" "$STATUS" "401"

step "2.2" "Request with bad key → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/plans/1" \
  -H "Authorization: Bearer sk_live_invalidkeyvalue")
assert_status "bad key → 401" "$STATUS" "401"

step "2.3" "Request with valid key → not 401"
STATUS=$(api_status GET /v1/plans/9999)
assert_not_contains "valid key not rejected" "$STATUS" "401"

step "2.4" "x-invoq-key header also accepted"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/plans/9999" \
  -H "x-invoq-key: $API_KEY")
assert_not_contains "x-invoq-key header accepted" "$STATUS" "401"

step "2.5" "Unknown route → 404"
STATUS=$(api_status GET /v1/doesnotexist)
assert_status "unknown route → 404" "$STATUS" "404"

########################################
# 3 — PLANS
########################################

section "3 — Plan management"

step "3.1" "POST /v1/plans — create paid plan (5 USDC/month)"
OUT=$(api POST /v1/plans '{
  "name": "API Pro",
  "priceUsdc": 50000000,
  "intervalSeconds": 2592000,
  "trialSeconds": 0,
  "usageLimit": 100000,
  "features": ["api_access","webhooks","export"]
}')
assert_json_field "plan creation returns planId" "$OUT" "planId"
assert_json_field "plan creation returns txHash" "$OUT" "txHash"
PLAN_ID=$(echo "$OUT" | jq -r '.planId')
echo "  → Plan ID: $PLAN_ID"

step "3.2" "POST /v1/plans — create free plan"
OUT=$(api POST /v1/plans '{
  "name": "Free Tier",
  "priceUsdc": 0,
  "intervalSeconds": 2592000,
  "usageLimit": 1000,
  "features": ["api_access"]
}')
assert_json_field "free plan returns planId" "$OUT" "planId"
FREE_PLAN_ID=$(echo "$OUT" | jq -r '.planId')
echo "  → Free Plan ID: $FREE_PLAN_ID"

step "3.3" "POST /v1/plans — missing required fields → 400"
STATUS=$(api_status POST /v1/plans '{"name":"Bad Plan"}')
assert_status "missing fields → 400" "$STATUS" "400"

step "3.4" "GET /v1/plans/:planId — read paid plan"
OUT=$(api GET "/v1/plans/$PLAN_ID")
assert_contains "plan name is API Pro"    "$OUT" "API Pro"
assert_contains "price is 50000000"       "$OUT" "50000000"
assert_contains "plan is active"          "$OUT" '"active":true'
assert_contains "webhooks feature exists" "$OUT" "webhooks"

step "3.5" "GET /v1/plans/9999 — non-existent plan → 404"
STATUS=$(api_status GET /v1/plans/9999)
assert_status "non-existent plan → 404" "$STATUS" "404"

step "3.6" "PATCH /v1/plans/:planId — update plan"
OUT=$(api PATCH "/v1/plans/$PLAN_ID" '{
  "name": "API Pro v2",
  "priceUsdc": 50000000,
  "usageLimit": 200000,
  "features": ["api_access","webhooks","export","analytics"]
}')
assert_json_field "update returns txHash" "$OUT" "txHash"

step "3.7" "GET /v1/plans/:planId — verify update applied"
OUT=$(api GET "/v1/plans/$PLAN_ID")
assert_contains "name updated"          "$OUT" "API Pro v2"
assert_contains "analytics feature added" "$OUT" "analytics"

step "3.8" "DELETE /v1/plans/:planId — deactivate plan"
OUT=$(api DELETE "/v1/plans/$PLAN_ID")
assert_json_field "deactivate returns txHash" "$OUT" "txHash"

step "3.9" "GET /v1/plans/:planId — verify deactivated"
OUT=$(api GET "/v1/plans/$PLAN_ID")
assert_contains "plan now inactive" "$OUT" '"active":false'

step "3.10" "POST /v1/plans/:planId/reactivate — reactivate plan"
OUT=$(api POST "/v1/plans/$PLAN_ID/reactivate")
assert_json_field "reactivate returns txHash" "$OUT" "txHash"

step "3.11" "GET /v1/plans/:planId — verify reactivated"
OUT=$(api GET "/v1/plans/$PLAN_ID")
assert_contains "plan active again" "$OUT" '"active":true'

########################################
# 4 — CHECKOUT
########################################

section "4 — Checkout (transaction building)"

step "4.1" "POST /v1/checkout/build-tx — build subscribe tx"
OUT=$(api POST /v1/checkout/build-tx "{
  \"customerAddress\": \"$CUSTOMER_ADDRESS\",
  \"planId\": \"$FREE_PLAN_ID\"
}")
if echo "$OUT" | jq -e '.xdr' > /dev/null 2>&1; then
  pass "build-tx returns XDR"
  XDR=$(echo "$OUT" | jq -r '.xdr')
  echo "  → XDR length: ${#XDR} chars"
else
  fail "build-tx did not return XDR (got: $OUT)"
  XDR=""
fi

step "4.2" "POST /v1/checkout/build-tx — missing fields → 400"
STATUS=$(api_status POST /v1/checkout/build-tx '{"customerAddress":"GABC"}')
assert_status "missing planId → 400" "$STATUS" "400"

step "4.3" "POST /v1/checkout/build-vault-tx — build vault creation tx"
OUT=$(api POST /v1/checkout/build-vault-tx "{
  \"customerAddress\": \"$CUSTOMER_ADDRESS\",
  \"developerAddress\": \"$CUSTOMER_ADDRESS\",
  \"initialDeposit\": 5000000,
  \"lowBalanceThreshold\": 1000000,
  \"autoTopupAmount\": 0
}")
if echo "$OUT" | jq -e '.xdr' > /dev/null 2>&1; then
  pass "build-vault-tx returns XDR"
else
  fail "build-vault-tx did not return XDR (got: $OUT)"
fi

step "4.4" "POST /v1/checkout/build-vault-tx — missing fields → 400"
STATUS=$(api_status POST /v1/checkout/build-vault-tx '{"customerAddress":"GABC"}')
assert_status "missing developerAddress → 400" "$STATUS" "400"

step "4.5" "POST /v1/checkout/submit-tx — bad signature rejected → 400"
STATUS=$(api_status POST /v1/checkout/submit-tx "{
  \"signedXdr\": \"AAAAAAAAAAAAA\",
  \"customerAddress\": \"$CUSTOMER_ADDRESS\",
  \"planId\": \"$FREE_PLAN_ID\"
}")
assert_status "bad signature → 400" "$STATUS" "400"

########################################
# 5 — ENTITLEMENT
########################################

section "5 — Entitlement checks"

step "5.1" "GET /v1/entitlement — missing params → 400"
STATUS=$(api_status GET "/v1/entitlement?customer=$CUSTOMER_ADDRESS")
assert_status "missing feature → 400" "$STATUS" "400"

step "5.2" "GET /v1/entitlement — check api_access"
OUT=$(api GET "/v1/entitlement?customer=$CUSTOMER_ADDRESS&feature=api_access")
assert_json_field "entitlement has entitled field" "$OUT" "entitled"
assert_json_field "entitlement has source field"   "$OUT" "source"
echo "  → entitled: $(echo "$OUT" | jq -r '.entitled'), source: $(echo "$OUT" | jq -r '.source')"

step "5.3" "GET /v1/entitlement — second call hits cache"
OUT=$(api GET "/v1/entitlement?customer=$CUSTOMER_ADDRESS&feature=api_access")
assert_contains "second call uses cache" "$OUT" '"source":"cache"'

step "5.4" "GET /v1/entitlement/full — full entitlement data"
OUT=$(api GET "/v1/entitlement/full?customer=$CUSTOMER_ADDRESS&feature=api_access")
# Returns 404 if no subscription, or full record if subscribed
if echo "$OUT" | grep -q '"error"'; then
  skip "5.4 — no active subscription yet (expected if no sub created)"
else
  assert_json_field "full entitlement has entitled"    "$OUT" "entitled"
  assert_json_field "full entitlement has usage_limit" "$OUT" "usage_limit"
  assert_json_field "full entitlement has status"      "$OUT" "status"
fi

step "5.5" "GET /v1/entitlement/full — missing params → 400"
STATUS=$(api_status GET "/v1/entitlement/full?customer=$CUSTOMER_ADDRESS")
assert_status "missing feature on /full → 400" "$STATUS" "400"

########################################
# 6 — USAGE
########################################

section "6 — Usage metering"

step "6.1" "POST /v1/usage/record — record 50 units"
OUT=$(api POST /v1/usage/record "{
  \"customer\": \"$CUSTOMER_ADDRESS\",
  \"units\": 50
}")
assert_contains "accepted is true"        "$OUT" '"accepted":true'
assert_json_field "bufferTotal returned"  "$OUT" "bufferTotal"
echo "  → Buffer total: $(echo "$OUT" | jq -r '.bufferTotal')"

step "6.2" "POST /v1/usage/record — record more units (buffer accumulates)"
OUT=$(api POST /v1/usage/record "{
  \"customer\": \"$CUSTOMER_ADDRESS\",
  \"units\": 100
}")
assert_contains "accepted is true" "$OUT" '"accepted":true'
BUFFER=$(echo "$OUT" | jq -r '.bufferTotal')
echo "  → Buffer total after 2nd record: $BUFFER"

step "6.3" "POST /v1/usage/record — zero units → 400"
STATUS=$(api_status POST /v1/usage/record "{
  \"customer\": \"$CUSTOMER_ADDRESS\",
  \"units\": 0
}")
assert_status "zero units → 400" "$STATUS" "400"

step "6.4" "POST /v1/usage/record — missing customer → 400"
STATUS=$(api_status POST /v1/usage/record '{"units":10}')
assert_status "missing customer → 400" "$STATUS" "400"

step "6.5" "GET /v1/usage/:customerAddress — read usage"
OUT=$(api GET "/v1/usage/$CUSTOMER_ADDRESS")
if echo "$OUT" | grep -q '"error"'; then
  skip "6.5 — no subscription for this customer yet"
else
  assert_json_field "usage has usageCurrent" "$OUT" "usageCurrent"
  assert_json_field "usage has periodStart"  "$OUT" "periodStart"
  assert_json_field "usage has periodEnd"    "$OUT" "periodEnd"
  assert_json_field "usage has status"       "$OUT" "status"
fi

########################################
# 7 — SUBSCRIPTIONS
########################################

section "7 — Subscription management"

step "7.1" "GET /v1/subscriptions/:customerAddress — read subscription"
OUT=$(api GET "/v1/subscriptions/$CUSTOMER_ADDRESS")
if echo "$OUT" | grep -q '"error"'; then
  skip "7.1 — no subscription for this customer (expected if not subscribed on-chain)"
  echo "  → Run the contract test.sh first to create a subscription"
else
  assert_json_field "sub has plan_id"       "$OUT" "plan_id"
  assert_json_field "sub has status"        "$OUT" "status"
  assert_json_field "sub has usage_current" "$OUT" "usage_current"
fi

step "7.2" "GET /v1/subscriptions/INVALIDADDRESS — bad address"
OUT=$(api GET "/v1/subscriptions/INVALIDADDRESS")
assert_contains "bad address returns error or 404" "$OUT" "error"

step "7.3" "DELETE /v1/subscriptions/:customerAddress — cancel (will fail if no sub)"
OUT=$(api DELETE "/v1/subscriptions/$CUSTOMER_ADDRESS" '{"immediate":false}')
if echo "$OUT" | grep -q '"txHash"'; then
  pass "cancel subscription returned txHash"
elif echo "$OUT" | grep -q '"error"'; then
  skip "7.3 — no active subscription to cancel"
else
  fail "unexpected cancel response: $OUT"
fi

########################################
# 8 — VAULT
########################################

section "8 — Vault operations"

step "8.1" "GET /v1/vault — missing params → 400"
STATUS=$(api_status GET "/v1/vault?customer=$CUSTOMER_ADDRESS")
assert_status "missing developer → 400" "$STATUS" "400"

step "8.2" "GET /v1/vault — non-existent vault → 404"
STATUS=$(api_status GET "/v1/vault?customer=$CUSTOMER_ADDRESS&developer=$CUSTOMER_ADDRESS")
assert_status "non-existent vault → 404" "$STATUS" "404"

step "8.3" "POST /v1/vault/debit — missing fields → 400"
STATUS=$(api_status POST /v1/vault/debit '{"customer":"GABC"}')
assert_status "missing debit fields → 400" "$STATUS" "400"

step "8.4" "POST /v1/vault/withdraw — missing fields → 400"
STATUS=$(api_status POST /v1/vault/withdraw '{"customer":"GABC"}')
assert_status "missing withdraw fields → 400" "$STATUS" "400"

step "8.5" "DELETE /v1/vault — missing fields → 400"
STATUS=$(api_status DELETE /v1/vault '{"customer":"GABC"}')
assert_status "missing close fields → 400" "$STATUS" "400"

step "8.6" "PATCH /v1/vault/threshold — missing fields → 400"
STATUS=$(api_status PATCH /v1/vault/threshold '{"customer":"GABC"}')
assert_status "missing threshold fields → 400" "$STATUS" "400"

########################################
# 9 — WEBHOOKS
########################################

section "9 — Webhook management"

step "9.1" "POST /v1/webhooks — create endpoint"
OUT=$(api POST /v1/webhooks '{
  "url": "https://example.com/webhook",
  "events": ["payment.renewed","payment.failed","subscription.cancelled"]
}')
assert_json_field "endpoint has id"            "$OUT" "id"
assert_json_field "endpoint has url"           "$OUT" "url"
assert_json_field "endpoint has signingSecret" "$OUT" "signingSecret"
assert_json_field "endpoint has active"        "$OUT" "active"
assert_contains   "endpoint is active"         "$OUT" '"active":true'
WEBHOOK_ENDPOINT_ID=$(echo "$OUT" | jq -r '.id')
echo "  → Endpoint ID: $WEBHOOK_ENDPOINT_ID"

step "9.2" "POST /v1/webhooks — missing url → 400"
STATUS=$(api_status POST /v1/webhooks '{"events":[]}')
assert_status "missing url → 400" "$STATUS" "400"

step "9.3" "GET /v1/webhooks — list endpoints"
OUT=$(api GET /v1/webhooks)
assert_contains "endpoint list is array" "$OUT" "["
assert_contains "created endpoint in list" "$OUT" "$WEBHOOK_ENDPOINT_ID"

step "9.4" "POST /v1/webhooks — create second endpoint (no event filter = all events)"
OUT=$(api POST /v1/webhooks '{
  "url": "https://example.com/webhook2"
}')
assert_json_field "second endpoint created" "$OUT" "id"
WEBHOOK_ENDPOINT_ID2=$(echo "$OUT" | jq -r '.id')

step "9.5" "GET /v1/webhooks — list shows both endpoints"
OUT=$(api GET /v1/webhooks)
assert_contains "first endpoint in list"  "$OUT" "$WEBHOOK_ENDPOINT_ID"
assert_contains "second endpoint in list" "$OUT" "$WEBHOOK_ENDPOINT_ID2"

step "9.6" "GET /v1/webhooks/log — delivery log"
OUT=$(api GET "/v1/webhooks/log")
assert_contains "log returns array" "$OUT" "["

step "9.7" "GET /v1/webhooks/log?limit=5 — delivery log with limit"
OUT=$(api GET "/v1/webhooks/log?limit=5")
assert_contains "limited log returns array" "$OUT" "["

step "9.8" "GET /v1/webhooks/log?status=delivered — filter by status"
OUT=$(api GET "/v1/webhooks/log?status=delivered")
assert_contains "filtered log returns array" "$OUT" "["

step "9.9" "DELETE /v1/webhooks/:endpointId — delete first endpoint"
OUT=$(api DELETE "/v1/webhooks/$WEBHOOK_ENDPOINT_ID")
assert_contains "delete returns true" "$OUT" '"deleted":true'

step "9.10" "GET /v1/webhooks — first endpoint gone"
OUT=$(api GET /v1/webhooks)
assert_not_contains "first endpoint removed" "$OUT" "$WEBHOOK_ENDPOINT_ID"
assert_contains     "second endpoint still there" "$OUT" "$WEBHOOK_ENDPOINT_ID2"

step "9.11" "DELETE /v1/webhooks/:endpointId — delete second endpoint (cleanup)"
OUT=$(api DELETE "/v1/webhooks/$WEBHOOK_ENDPOINT_ID2")
assert_contains "second endpoint deleted" "$OUT" '"deleted":true'

########################################
# SUMMARY
########################################

echo ""
echo -e "${BOLD}╔════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           Test Results Summary             ║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}✓ Passed:  $PASS${NC}"
echo -e "  ${RED}✗ Failed:  $FAIL${NC}"
echo -e "  ${YELLOW}⊘ Skipped: $SKIP${NC}"
echo ""

TOTAL=$((PASS + FAIL))
if [ $TOTAL -gt 0 ]; then
  PCT=$(( PASS * 100 / TOTAL ))
  echo "  Pass rate: $PCT% ($PASS / $TOTAL)"
fi

echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  ✅ All tests passed. API is ready.${NC}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  ❌ $FAIL test(s) failed. Check output above.${NC}"
  echo ""
  exit 1
fi