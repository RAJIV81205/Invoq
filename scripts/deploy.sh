#!/bin/bash

# =============================================================================
# Invoq — Deployment Script
# =============================================================================
#
# USAGE
# ─────
#   npm run deploy               — Deploy SubscriptionRegistry + BillingCycle
#   npm run deploy:spend-policy  — Deploy SpendPolicy only (standalone)
#
#   Or directly:
#   bash scripts/deploy.sh                      (default: registry + billing)
#   bash scripts/deploy.sh --mode spend-policy  (SpendPolicy only)

set -e

########################################
# COLOURS
########################################

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

########################################
# PARSE ARGS
########################################

MODE="core"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

########################################
# CONFIG
########################################

NETWORK="testnet"
SOURCE="mywallet"

USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
GRACE_PERIOD="259200"

# WASM paths (built by: npm run compile)
REGISTRY_WASM="target/wasm32v1-none/release/subscription_registry.wasm"
BILLING_WASM="target/wasm32v1-none/release/billing_cycle.wasm"
SPEND_POLICY_WASM="target/wasm32v1-none/release/spend_policy.wasm"

ADMIN_ADDRESS=$(stellar keys address $SOURCE)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Invoq Deployment Script          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Mode:    $MODE"
echo "  Network: $NETWORK"
echo "  Admin:   $ADMIN_ADDRESS"
echo "  USDC:    $USDC_SAC"
echo ""

########################################
# HELPERS
########################################

deploy_and_init_registry() {
  echo -e "${CYAN}── Deploying SubscriptionRegistry...${NC}"
  REGISTRY_ID=$(stellar contract deploy \
    --wasm $REGISTRY_WASM \
    --source-account $SOURCE \
    --network $NETWORK \
    --alias subscription_registry)
  echo "  Contract ID: $REGISTRY_ID"

  echo -e "${CYAN}── Initializing SubscriptionRegistry...${NC}"
  stellar contract invoke \
    --id $REGISTRY_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN_ADDRESS \
    --usdc_sac $USDC_SAC
  echo -e "  ${GREEN}✓ Registry initialized${NC}"
}

deploy_and_init_billing() {
  echo -e "${CYAN}── Deploying BillingCycle...${NC}"
  BILLING_ID=$(stellar contract deploy \
    --wasm $BILLING_WASM \
    --source-account $SOURCE \
    --network $NETWORK \
    --alias billing_cycle)
  echo "  Contract ID: $BILLING_ID"

  echo -e "${CYAN}── Initializing BillingCycle...${NC}"
  stellar contract invoke \
    --id $BILLING_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN_ADDRESS \
    --registry_id $REGISTRY_ID \
    --usdc_sac $USDC_SAC \
    --grace_period_seconds $GRACE_PERIOD
  echo -e "  ${GREEN}✓ BillingCycle initialized${NC}"
}

wire_operator() {
  echo -e "${CYAN}── Granting operator rights (Registry → BillingCycle)...${NC}"
  stellar contract invoke \
    --id $REGISTRY_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- set_operator \
    --operator $BILLING_ID
  echo -e "  ${GREEN}✓ Operator set: BillingCycle is now Registry operator${NC}"
}

deploy_and_init_spend_policy() {
  echo -e "${CYAN}── Deploying SpendPolicy...${NC}"
  SPEND_POLICY_ID=$(stellar contract deploy \
    --wasm $SPEND_POLICY_WASM \
    --source-account $SOURCE \
    --network $NETWORK \
    --alias spend_policy)
  echo "  Contract ID: $SPEND_POLICY_ID"

  echo -e "${CYAN}── Initializing SpendPolicy...${NC}"
  stellar contract invoke \
    --id $SPEND_POLICY_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN_ADDRESS
  echo -e "  ${GREEN}✓ SpendPolicy initialized${NC}"
}

print_output() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║       Deployment Complete            ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
  [ -n "$REGISTRY_ID"     ] && echo "  Registry:     $REGISTRY_ID"
  [ -n "$BILLING_ID"      ] && echo "  BillingCycle: $BILLING_ID"
  [ -n "$SPEND_POLICY_ID" ] && echo "  SpendPolicy:  $SPEND_POLICY_ID"
  echo ""
  echo "  Update lib/config.ts with the contract IDs above."
  echo ""
  [ -n "$REGISTRY_ID"     ] && echo "  https://stellar.expert/explorer/testnet/contract/$REGISTRY_ID"
  [ -n "$BILLING_ID"      ] && echo "  https://stellar.expert/explorer/testnet/contract/$BILLING_ID"
  [ -n "$SPEND_POLICY_ID" ] && echo "  https://stellar.expert/explorer/testnet/contract/$SPEND_POLICY_ID"
  echo ""
}

########################################
# EXECUTE
########################################

case "$MODE" in

  core)
    # Deploy SubscriptionRegistry + BillingCycle and wire them together.
    # This is what `npm run deploy` runs.
    deploy_and_init_registry
    deploy_and_init_billing
    wire_operator
    print_output
    ;;

  spend-policy)
    # Deploy SpendPolicy only. Completely standalone — Registry and
    # BillingCycle are not touched. This is what `npm run deploy:spend-policy` runs.
    deploy_and_init_spend_policy
    print_output
    ;;

  *)
    echo "Unknown mode: $MODE"
    echo "Valid modes: core | spend-policy"
    echo ""
    echo "Usage:"
    echo "  npm run deploy               (core: Registry + BillingCycle)"
    echo "  npm run deploy:spend-policy  (SpendPolicy only)"
    exit 1
    ;;

esac
