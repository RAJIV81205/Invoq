#!/bin/bash

# =============================================================================
# Invoq — Phase 1 Smoke Test Script
# =============================================================================
#
# Tests the complete subscription lifecycle end-to-end on Stellar testnet:
#
#   1.  Verify contracts are initialized (get_admin, get_operator)
#   2.  Create plans (paid, free, trial)
#   3.  Read plans back and verify fields
#   4.  Update a plan
#   5.  Plan validation (expected rejections)
#   6.  Subscription creation
#   7.  Trial plan subscription (skipped — requires second wallet)
#   8.  Entitlement checks
#   9.  Usage metering
#   10. Subscription cancellation
#   11. Re-subscription after cancellation
#   12. Plan deactivation / reactivation
#   13. BillingCycle admin functions
#   14. Operator management
#   15. Admin transfer
#   16. USDC / paid plan integration note
#
# USAGE
# ─────
#   bash scripts/test.sh
#
# REQUIREMENTS
# ─────────────
#   - Both contracts deployed and initialized (run deploy.sh first)
#   - stellar CLI installed and configured
#   - SOURCE wallet funded with XLM on testnet
#
# NOTE ON set -e
# ──────────────
# We do NOT use set -e so that individual test failures are captured and
# counted rather than aborting the whole run. Each invocation that is
# expected to fail uses `|| true` to prevent shell exit.

# Do NOT use set -e — we want all tests to run even when some fail.

########################################
# COLOURS
########################################

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # no colour

########################################
# CONFIG
########################################

NETWORK="testnet"
SOURCE="mywallet"
CUSTOMER_SOURCE="alice"

# Manually set contract IDs
REGISTRY_CONTRACT_ID="CA5EBEO2CFNQQTJVH7NYJSMDLDECCQKD4QFO5EK33QM2E4H3C2XXRAR7"
BILLING_CONTRACT_ID="CA3RQ7ZSF56P2NYIBGWQPE6F2N5Q3MBIEMCT45BKS4ACKUC7B5Y6UQKC"

# Validate
if [ -z "$REGISTRY_CONTRACT_ID" ] || [ -z "$BILLING_CONTRACT_ID" ]; then
  echo -e "${RED}Error: REGISTRY_CONTRACT_ID or BILLING_CONTRACT_ID not set.${NC}"
  exit 1
fi

ADMIN_ADDRESS=$(stellar keys address $SOURCE)
CUSTOMER_ADDRESS=$(stellar keys address $CUSTOMER_SOURCE)

########################################
# COUNTERS
########################################

PASS=0
FAIL=0
SKIP=0

########################################
# HELPERS
########################################

section() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${BOLD}  $1${NC}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

step() {
  echo -e "${BOLD}[$1]${NC} $2"
}

pass() {
  echo -e "  ${GREEN}✓ PASS${NC} — $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "  ${RED}✗ FAIL${NC} — $1"
  FAIL=$((FAIL + 1))
}

skip() {
  echo -e "  ${YELLOW}⊘ SKIP${NC} — $1"
  SKIP=$((SKIP + 1))
}

# invoke_registry: calls Registry signed as admin (mywallet)
invoke_registry() {
  stellar contract invoke \
    --id $REGISTRY_CONTRACT_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- "$@" 2>&1
}

# invoke_billing: calls BillingCycle signed as admin (mywallet)
invoke_billing() {
  stellar contract invoke \
    --id $BILLING_CONTRACT_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- "$@" 2>&1
}

# invoke_billing_as: calls BillingCycle signed as a specific source account
# Usage: invoke_billing_as alice initiate_subscription --customer ... --plan_id ...
invoke_billing_as() {
  local signer="$1"
  shift
  stellar contract invoke \
    --id $BILLING_CONTRACT_ID \
    --source-account "$signer" \
    --network $NETWORK \
    -- "$@" 2>&1
}

# invoke_registry_as: calls Registry signed as a specific source account
# Usage: invoke_registry_as alice cancel_subscription --customer ... --immediate true
invoke_registry_as() {
  local signer="$1"
  shift
  stellar contract invoke \
    --id $REGISTRY_CONTRACT_ID \
    --source-account "$signer" \
    --network $NETWORK \
    -- "$@" 2>&1
}

# assert_contains: checks that OUTPUT contains EXPECTED string
assert_contains() {
  local label="$1"
  local output="$2"
  local expected="$3"
  if echo "$output" | grep -q "$expected"; then
    pass "$label"
  else
    fail "$label (expected '$expected' in output, got: $output)"
  fi
}

# assert_not_contains: checks that OUTPUT does NOT contain EXPECTED string
assert_not_contains() {
  local label="$1"
  local output="$2"
  local expected="$3"
  if echo "$output" | grep -q "$expected"; then
    fail "$label (expected '$expected' NOT to be in output, got: $output)"
  else
    pass "$label"
  fi
}

# assert_success: checks that command did not return an error
assert_success() {
  local label="$1"
  local output="$2"
  if echo "$output" | grep -qi "error\|failed\|panic"; then
    fail "$label (unexpected error: $output)"
  else
    pass "$label"
  fi
}

# assert_error: checks that command DID return an error (for negative tests)
assert_error() {
  local label="$1"
  local output="$2"
  if echo "$output" | grep -qi "error\|failed\|panic"; then
    pass "$label (correctly rejected)"
  else
    fail "$label (expected rejection but got success: $output)"
  fi
}

########################################
# BANNER
########################################

echo ""
echo -e "${BOLD}╔════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Invoq — Phase 1 Contract Smoke Tests    ║${NC}"
echo -e "${BOLD}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "  Network:         $NETWORK"
echo "  Admin:           $ADMIN_ADDRESS  ($SOURCE)"
echo "  Customer:        $CUSTOMER_ADDRESS  ($CUSTOMER_SOURCE)"
echo "  Registry:        $REGISTRY_CONTRACT_ID"
echo "  BillingCycle:    $BILLING_CONTRACT_ID"
echo ""

########################################
# TEST 1 — CONTRACT INITIALISATION
########################################

section "1 — Verify contract initialisation"

step "1.1" "Registry: get_admin"
OUT=$(invoke_registry get_admin)
assert_contains "Registry admin matches deploy wallet" "$OUT" "$ADMIN_ADDRESS"

step "1.2" "Registry: get_operator should be BillingCycle"
OUT=$(invoke_registry get_operator)
assert_contains "Registry operator is BillingCycle" "$OUT" "$BILLING_CONTRACT_ID"

step "1.3" "BillingCycle: get_admin"
OUT=$(invoke_billing get_admin)
assert_contains "BillingCycle admin matches deploy wallet" "$OUT" "$ADMIN_ADDRESS"

step "1.4" "BillingCycle: get_grace_period"
OUT=$(invoke_billing get_grace_period)
assert_contains "Grace period is set" "$OUT" "259200"

step "1.5" "BillingCycle: get_registry_id"
OUT=$(invoke_billing get_registry_id)
assert_contains "BillingCycle points at Registry" "$OUT" "$REGISTRY_CONTRACT_ID"

########################################
# TEST 2 — PLAN CREATION
########################################

section "2 — Plan creation"

step "2.1" "Create a paid monthly plan (5 USDC/month)"
# Use create_plan (owner signs directly). create_plan_for requires the
# operator (BillingCycle contract) to sign — it has no wallet key on testnet.
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "Pro Monthly" \
  --price_usdc 50000000 \
  --interval_seconds 2592000 \
  --trial_seconds 0 \
  --usage_limit 100000 \
  --features '["api_access","webhooks","export"]' 2>&1 || true)
assert_success "create_plan (paid plan)" "$OUT"
# Stellar CLI returns the plan_id as a plain integer on its own line
PAID_PLAN_ID=$(echo "$OUT" | grep -o '[0-9]\+' | tail -1)
echo "  → Paid plan ID: $PAID_PLAN_ID"

step "2.2" "Create a free plan (0 USDC, no trial)"
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "Free Tier" \
  --price_usdc 0 \
  --interval_seconds 2592000 \
  --trial_seconds 0 \
  --usage_limit 1000 \
  --features '["api_access"]' 2>&1 || true)
assert_success "create_plan (free plan)" "$OUT"
FREE_PLAN_ID=$(echo "$OUT" | grep -o '[0-9]\+' | tail -1)
echo "  → Free plan ID: $FREE_PLAN_ID"

step "2.3" "Create a plan with a 7-day trial"
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "Pro Trial" \
  --price_usdc 50000000 \
  --interval_seconds 2592000 \
  --trial_seconds 604800 \
  --usage_limit 100000 \
  --features '["api_access","webhooks"]' 2>&1 || true)
assert_success "create_plan (trial plan)" "$OUT"
TRIAL_PLAN_ID=$(echo "$OUT" | grep -o '[0-9]\+' | tail -1)
echo "  → Trial plan ID: $TRIAL_PLAN_ID"

step "2.4" "plan_count should equal TRIAL_PLAN_ID (last created plan)"
# We compare against TRIAL_PLAN_ID because the contract may already have plans
# from previous test runs — plan_count is monotonically increasing.
OUT=$(invoke_registry plan_count 2>&1 || true)
assert_contains "plan_count matches last plan ID" "$OUT" "$TRIAL_PLAN_ID"

########################################
# TEST 3 — PLAN READS
########################################

section "3 — Plan reads"

step "3.1" "get_plan returns paid plan config"
OUT=$(invoke_registry get_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_contains "plan name is Pro Monthly"  "$OUT" "Pro Monthly"
assert_contains "price is 50000000 stroops" "$OUT" "50000000"
assert_contains "plan is active"            "$OUT" "active"

step "3.2" "get_plan returns free plan config"
OUT=$(invoke_registry get_plan --plan_id "$FREE_PLAN_ID" 2>&1 || true)
assert_contains "free plan name is Free Tier" "$OUT" "Free Tier"
# Stellar CLI serializes i128 as a quoted string: "price_usdc":"0"
assert_contains "free plan price is 0"        "$OUT" '"price_usdc":"0"'

step "3.3" "get_plan returns None for non-existent plan"
OUT=$(invoke_registry get_plan --plan_id 9999 2>&1 || true)
assert_contains "non-existent plan returns null/None" "$OUT" "null"

########################################
# TEST 4 — PLAN UPDATES
########################################

section "4 — Plan updates"

step "4.1" "update_plan: change name and usage_limit"
OUT=$(invoke_registry update_plan \
  --plan_id "$PAID_PLAN_ID" \
  --name "Pro Monthly v2" \
  --price_usdc 50000000 \
  --usage_limit 200000 \
  --features '["api_access","webhooks","export","analytics"]' 2>&1 || true)
assert_success "update_plan succeeds" "$OUT"

step "4.2" "Verify update applied"
OUT=$(invoke_registry get_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_contains "name updated to Pro Monthly v2" "$OUT" "Pro Monthly v2"
assert_contains "usage_limit updated to 200000"  "$OUT" "200000"
assert_contains "analytics feature added"        "$OUT" "analytics"

########################################
# TEST 5 — PLAN VALIDATION (negative tests)
########################################

section "5 — Plan validation (expected rejections)"

step "5.1" "Empty plan name should be rejected"
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "" \
  --price_usdc 0 \
  --interval_seconds 2592000 \
  --trial_seconds 0 \
  --usage_limit 0 \
  --features '[]' 2>&1 || true)
assert_error "empty name rejected (InvalidPlanName)" "$OUT"

step "5.2" "Interval below 1 day should be rejected"
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "Bad Plan" \
  --price_usdc 0 \
  --interval_seconds 3600 \
  --trial_seconds 0 \
  --usage_limit 0 \
  --features '[]' 2>&1 || true)
assert_error "short interval rejected (InvalidInterval)" "$OUT"

step "5.3" "Negative price should be rejected"
OUT=$(invoke_registry create_plan \
  --owner "$ADMIN_ADDRESS" \
  --name "Negative Plan" \
  --price_usdc -1 \
  --interval_seconds 2592000 \
  --trial_seconds 0 \
  --usage_limit 0 \
  --features '[]' 2>&1 || true)
assert_error "negative price rejected (InvalidPrice)" "$OUT"

########################################
# TEST 6 — SUBSCRIPTION CREATION
########################################

section "6 — Subscription creation"

# Alice (CUSTOMER_SOURCE) subscribes to the free plan.
# She signs the transaction herself — initiate_subscription requires customer.require_auth().
step "6.1" "initiate_subscription on free plan (alice subscribes)"
OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$FREE_PLAN_ID" 2>&1 || true)
assert_success "initiate_subscription on free plan" "$OUT"

step "6.2" "get_subscription returns the record"
OUT=$(invoke_registry get_subscription --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "subscription record exists"    "$OUT" "plan_id"
assert_contains "status is Active"             "$OUT" "Active"
assert_contains "cancel_at_period_end is false" "$OUT" "false"
assert_contains "usage_current is 0"           "$OUT" '"usage_current":0'

step "6.3" "is_subscribed returns true"
OUT=$(invoke_registry is_subscribed --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "is_subscribed = true" "$OUT" "true"

step "6.4" "Duplicate subscription should be rejected"
OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$FREE_PLAN_ID" 2>&1 || true)
assert_error "duplicate subscription rejected (AlreadySubscribed)" "$OUT"

########################################
# TEST 7 — TRIAL PLAN SUBSCRIPTION (alice)
########################################

section "7 — Trial plan subscription"

# Alice already has an active subscription on FREE_PLAN_ID.
# We cancel it first, then re-subscribe on the TRIAL plan to test the
# Trialing status and trial_end field.

step "7.1" "Cancel alice's free plan subscription before trial test"
OUT=$(invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate true 2>&1 || true)
assert_success "cancel free plan before trial test" "$OUT"

step "7.2" "Subscribe alice to the trial plan"
OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$TRIAL_PLAN_ID" 2>&1 || true)
assert_success "initiate_subscription on trial plan" "$OUT"

step "7.3" "Subscription status is Trialing"
OUT=$(invoke_registry get_subscription --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "status is Trialing"   "$OUT" "Trialing"
assert_contains "trial_end is set"     "$OUT" "trial_end"
assert_contains "plan_id is trial plan" "$OUT" "$TRIAL_PLAN_ID"

step "7.4" "Entitlement is granted during trial"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "api_access granted during trial" "$OUT" "true"

step "7.5" "Cancel trial and re-subscribe to free plan for remaining tests"
invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate true > /dev/null 2>&1 || true
OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$FREE_PLAN_ID" 2>&1 || true)
assert_success "re-subscribe to free plan after trial" "$OUT"

########################################
# TEST 8 — ENTITLEMENT CHECKS
########################################

section "8 — Entitlement checks"

# Define a fake address used throughout sections 8 and 13
FAKE_ADDR="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"

step "8.1" "check_entitlement for api_access (should be true)"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "api_access granted" "$OUT" "true"

step "8.2" "check_entitlement for webhooks (not in free plan — should be false)"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "webhooks" 2>&1 || true)
assert_contains "webhooks not granted on free plan" "$OUT" "false"

step "8.3" "check_entitlement for unknown feature (should be false)"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "nonexistent_feature" 2>&1 || true)
assert_contains "unknown feature not granted" "$OUT" "false"

step "8.4" "check_entitlement for unsubscribed wallet (should be false)"
OUT=$(invoke_registry check_entitlement \
  --customer "$FAKE_ADDR" \
  --feature "api_access" 2>&1 || true)
assert_contains "unsubscribed wallet not entitled" "$OUT" "false"

step "8.5" "check_entitlement_full returns usage data"
OUT=$(invoke_registry check_entitlement_full \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "entitled is true"    "$OUT" "true"
# u64 fields are plain numbers in Stellar CLI JSON output
assert_contains "usage_current is 0"  "$OUT" '"usage_current":0'
assert_contains "usage_limit is 1000" "$OUT" '"usage_limit":1000'
assert_contains "status is Active"    "$OUT" "Active"

########################################
# TEST 9 — USAGE METERING
########################################

section "9 — Usage metering"

step "9.1" "increment_usage by 100"
OUT=$(invoke_registry increment_usage \
  --customer "$CUSTOMER_ADDRESS" \
  --units 100 2>&1 || true)
# u64 return value is a plain number in Stellar CLI output
assert_contains "increment_usage returns 100" "$OUT" "100"

step "9.2" "increment_usage by 250 (should be 350 total)"
OUT=$(invoke_registry increment_usage \
  --customer "$CUSTOMER_ADDRESS" \
  --units 250 2>&1 || true)
assert_contains "total usage is 350" "$OUT" "350"

step "9.3" "check_entitlement_full shows updated usage"
OUT=$(invoke_registry check_entitlement_full \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "usage_current is 350" "$OUT" "350"

step "9.4" "increment_usage with 0 units should be rejected"
OUT=$(invoke_registry increment_usage \
  --customer "$CUSTOMER_ADDRESS" \
  --units 0 2>&1 || true)
assert_error "zero units rejected (ZeroUnits)" "$OUT"

step "9.5" "increment_usage_batch — 1 entry"
OUT=$(invoke_registry increment_usage_batch \
  --entries '[{"customer":"'"$CUSTOMER_ADDRESS"'","units":50}]' 2>&1 || true)
assert_success "increment_usage_batch succeeds" "$OUT"
assert_contains "batch returned 1 success" "$OUT" "1"

step "9.6" "Verify total usage is now 400"
OUT=$(invoke_registry check_entitlement_full \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "usage_current is 400" "$OUT" "400"

########################################
# TEST 10 — SUBSCRIPTION CANCELLATION
########################################

section "10 — Subscription cancellation"

step "10.1" "cancel_subscription end-of-period (alice cancels herself)"
OUT=$(invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate false 2>&1 || true)
assert_success "cancel_subscription (end of period)" "$OUT"

step "10.2" "cancel_at_period_end is now set"
OUT=$(invoke_registry get_subscription --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "cancel_at_period_end is true" "$OUT" '"cancel_at_period_end":true'

step "10.3" "still entitled until period ends (cancel is scheduled)"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "still entitled after schedule-cancel" "$OUT" "true"

step "10.4" "re-setting cancel_at_period_end is idempotent"
OUT=$(invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate false 2>&1 || true)
assert_success "re-setting cancel_at_period_end is accepted" "$OUT"

step "10.5" "immediate cancel"
OUT=$(invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate true 2>&1 || true)
assert_success "cancel_subscription (immediate)" "$OUT"

step "10.6" "status is Cancelled"
OUT=$(invoke_registry get_subscription --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "status is Cancelled" "$OUT" "Cancelled"

step "10.7" "entitlement is false after immediate cancel"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "not entitled after cancel" "$OUT" "false"

step "10.8" "is_subscribed is false"
OUT=$(invoke_registry is_subscribed --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "is_subscribed = false" "$OUT" "false"

step "10.9" "triple cancel should be rejected (AlreadyCancelled)"
OUT=$(invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate true 2>&1 || true)
assert_error "cancel on cancelled sub rejected" "$OUT"

########################################
# TEST 11 — RE-SUBSCRIPTION
########################################

section "11 — Re-subscription after cancellation"

step "11.1" "Re-subscribe alice on the same free plan after cancellation"
OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$FREE_PLAN_ID" 2>&1 || true)
assert_success "re-subscription after cancel" "$OUT"

step "11.2" "New subscription is Active"
OUT=$(invoke_registry get_subscription --customer "$CUSTOMER_ADDRESS" 2>&1 || true)
assert_contains "new sub is Active"    "$OUT" "Active"
assert_contains "usage reset to 0"     "$OUT" '"usage_current":0'
assert_contains "cancel flag is false" "$OUT" '"cancel_at_period_end":false'

step "11.3" "Entitlement restored"
OUT=$(invoke_registry check_entitlement \
  --customer "$CUSTOMER_ADDRESS" \
  --feature "api_access" 2>&1 || true)
assert_contains "entitlement restored after re-sub" "$OUT" "true"

########################################
# TEST 12 — PLAN DEACTIVATION
########################################

section "12 — Plan deactivation"

step "12.1" "deactivate_plan on paid plan"
OUT=$(invoke_registry deactivate_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_success "deactivate_plan" "$OUT"

step "12.2" "get_plan shows active=false"
OUT=$(invoke_registry get_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_contains "plan is now inactive" "$OUT" '"active":false'

step "12.3" "double deactivate should be rejected (AlreadyInactive)"
OUT=$(invoke_registry deactivate_plan \
  --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_error "double deactivate rejected" "$OUT"

step "12.4" "new subscription on deactivated plan rejected (PlanInactive)"
# Cancel alice's current sub first so we can attempt a fresh subscribe
invoke_registry_as $CUSTOMER_SOURCE cancel_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --immediate true > /dev/null 2>&1 || true

OUT=$(invoke_billing_as $CUSTOMER_SOURCE initiate_subscription \
  --customer "$CUSTOMER_ADDRESS" \
  --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_error "subscribe on inactive plan rejected" "$OUT"

step "12.5" "reactivate_plan"
OUT=$(invoke_registry reactivate_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_success "reactivate_plan" "$OUT"

step "12.6" "get_plan shows active=true again"
OUT=$(invoke_registry get_plan --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_contains "plan is active again" "$OUT" '"active":true'

step "12.7" "double reactivate should be rejected (AlreadyActive)"
OUT=$(invoke_registry reactivate_plan \
  --plan_id "$PAID_PLAN_ID" 2>&1 || true)
assert_error "double reactivate rejected" "$OUT"

########################################
# TEST 13 — BILLINGCYCLE FUNCTIONS
########################################

section "13 — BillingCycle admin functions"

step "13.1" "set_grace_period to 1 day (86400 seconds)"
OUT=$(invoke_billing set_grace_period --new_grace_seconds 86400 2>&1 || true)
assert_success "set_grace_period" "$OUT"

step "13.2" "get_grace_period returns updated value"
OUT=$(invoke_billing get_grace_period 2>&1 || true)
assert_contains "grace period is 86400" "$OUT" "86400"

step "13.3" "set_grace_period below minimum (3600) is rejected"
OUT=$(invoke_billing set_grace_period \
  --new_grace_seconds 1800 2>&1 || true)
assert_error "grace period below minimum rejected" "$OUT"

step "13.4" "get_grace_record for non-subscriber returns null"
OUT=$(invoke_billing get_grace_record --customer "$FAKE_ADDR" 2>&1 || true)
assert_contains "no grace record for unknown customer" "$OUT" "null"

step "13.5" "retry_payment for non-grace-period customer is rejected"
OUT=$(invoke_billing retry_payment \
  --customer "$FAKE_ADDR" 2>&1 || true)
assert_error "retry_payment with no grace record rejected" "$OUT"

step "13.6" "process_renewals with empty batch returns zero"
OUT=$(invoke_billing process_renewals --customers '[]' 2>&1 || true)
assert_success "process_renewals empty batch" "$OUT"
# u32 fields are plain numbers in Stellar CLI JSON output
assert_contains "renewed = 0"       "$OUT" '"renewed":0'
assert_contains "grace_entered = 0" "$OUT" '"grace_entered":0'
assert_contains "skipped = 0"       "$OUT" '"skipped":0'

step "13.7" "expire_grace_periods with empty batch returns 0"
OUT=$(invoke_billing expire_grace_periods --customers '[]' 2>&1 || true)
assert_contains "expired = 0" "$OUT" "0"

step "13.8" "process_renewals batch over 30 is rejected"
# Build a JSON array of 31 addresses
BIG_BATCH='['
for i in $(seq 1 31); do
  BIG_BATCH="${BIG_BATCH}\"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN\""
  [ $i -lt 31 ] && BIG_BATCH="${BIG_BATCH},"
done
BIG_BATCH="${BIG_BATCH}]"

OUT=$(invoke_billing process_renewals \
  --customers "$BIG_BATCH" 2>&1 || true)
assert_error "batch over 30 rejected (BatchTooLarge)" "$OUT"

########################################
# TEST 14 — OPERATOR MANAGEMENT
########################################

section "14 — Operator management"

step "14.1" "get_operator returns BillingCycle"
OUT=$(invoke_registry get_operator 2>&1 || true)
assert_contains "operator is BillingCycle" "$OUT" "$BILLING_CONTRACT_ID"

step "14.2" "revoke_operator"
OUT=$(invoke_registry revoke_operator 2>&1 || true)
assert_success "revoke_operator" "$OUT"

step "14.3" "get_operator returns null after revoke"
OUT=$(invoke_registry get_operator 2>&1 || true)
assert_contains "operator is null after revoke" "$OUT" "null"

step "14.4" "restore operator (needed for future tests)"
OUT=$(invoke_registry set_operator --operator "$BILLING_CONTRACT_ID" 2>&1 || true)
assert_success "set_operator restored" "$OUT"

step "14.5" "operator is BillingCycle again"
OUT=$(invoke_registry get_operator 2>&1 || true)
assert_contains "operator is restored" "$OUT" "$BILLING_CONTRACT_ID"

########################################
# TEST 15 — ADMIN TRANSFER
########################################

section "15 — Admin transfer"

# We transfer to the same address (no-op effect) just to verify the function works.
step "15.1" "transfer_admin to same address (verify function works)"
OUT=$(invoke_registry transfer_admin --new_admin "$ADMIN_ADDRESS" 2>&1 || true)
assert_success "transfer_admin" "$OUT"

step "15.2" "admin is still the same address"
OUT=$(invoke_registry get_admin 2>&1 || true)
assert_contains "admin unchanged after self-transfer" "$OUT" "$ADMIN_ADDRESS"

########################################
# TEST 16 — USDC INTEGRATION NOTE
########################################

section "16 — USDC / paid plan integration"

echo "  Note: paid plan subscription tests require testnet USDC."
echo ""
echo "  To test paid flows:"
echo "   1. Get testnet USDC from: https://usdcfaucet.circle.com"
echo "   2. Approve BillingCycle as spender:"
echo "      stellar contract invoke \\"
echo "        --id $USDC_SAC \\"
echo "        --source-account $SOURCE \\"
echo "        --network testnet \\"
echo "        -- approve \\"
echo "        --from $ADMIN_ADDRESS \\"
echo "        --spender $BILLING_CONTRACT_ID \\"
echo "        --amount 500000000 \\"
echo "        --expiration_ledger 999999999"
echo ""
echo "   3. Subscribe to the paid plan:"
echo "      stellar contract invoke \\"
echo "        --id $BILLING_CONTRACT_ID \\"
echo "        --source-account $SOURCE \\"
echo "        --network testnet \\"
echo "        -- initiate_subscription \\"
echo "        --customer $ADMIN_ADDRESS \\"
echo "        --plan_id $PAID_PLAN_ID"
echo ""
skip "Paid plan USDC flow skipped — requires testnet USDC balance"

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
echo "  Registry:     https://stellar.expert/explorer/testnet/contract/$REGISTRY_CONTRACT_ID"
echo "  BillingCycle: https://stellar.expert/explorer/testnet/contract/$BILLING_CONTRACT_ID"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  ✅ All tests passed. Contracts are ready.${NC}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  ❌ $FAIL test(s) failed. Check output above.${NC}"
  echo ""
  exit 1
fi