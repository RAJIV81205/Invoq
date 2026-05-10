#!/bin/bash

# =============================================================================
# Invoq — Deployment Script
# =============================================================================
#
# USAGE
# ─────
#   npm run deploy               — Deploy SubscriptionRegistry + BillingCycle
#   npm run deploy:spend-policy  — Deploy SpendPolicy only (standalone)
#   npm run deploy:escrow-vault  — Deploy EscrowVault only (standalone)
#
#   Or directly:
#   bash scripts/deploy.sh                       (default: registry + billing)
#   bash scripts/deploy.sh --mode spend-policy   (SpendPolicy only)
#   bash scripts/deploy.sh --mode escrow-vault   (EscrowVault only)

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
ESCROW_VAULT_WASM="target/wasm32v1-none/release/escrow_vault.wasm"

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

deploy_and_init_escrow_vault() {
  echo -e "${CYAN}── Deploying EscrowVault...${NC}"
  ESCROW_VAULT_ID=$(stellar contract deploy \
    --wasm $ESCROW_VAULT_WASM \
    --source-account $SOURCE \
    --network $NETWORK \
    --alias escrow_vault)
  echo "  Contract ID: $ESCROW_VAULT_ID"

  echo -e "${CYAN}── Initializing EscrowVault...${NC}"
  stellar contract invoke \
    --id $ESCROW_VAULT_ID \
    --source-account $SOURCE \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN_ADDRESS \
    --usdc_sac $USDC_SAC
  echo -e "  ${GREEN}✓ EscrowVault initialized${NC}"
}

print_output() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║       Deployment Complete            ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
  [ -n "$REGISTRY_ID"      ] && echo "  Registry:     $REGISTRY_ID"
  [ -n "$BILLING_ID"       ] && echo "  BillingCycle: $BILLING_ID"
  [ -n "$SPEND_POLICY_ID"  ] && echo "  SpendPolicy:  $SPEND_POLICY_ID"
  [ -n "$ESCROW_VAULT_ID"  ] && echo "  EscrowVault:  $ESCROW_VAULT_ID"
  echo ""
  echo "  Update lib/config.ts with the contract IDs above."
  echo ""
  [ -n "$REGISTRY_ID"      ] && echo "  https://stellar.expert/explorer/testnet/contract/$REGISTRY_ID"
  [ -n "$BILLING_ID"       ] && echo "  https://stellar.expert/explorer/testnet/contract/$BILLING_ID"
  [ -n "$SPEND_POLICY_ID"  ] && echo "  https://stellar.expert/explorer/testnet/contract/$SPEND_POLICY_ID"
  [ -n "$ESCROW_VAULT_ID"  ] && echo "  https://stellar.expert/explorer/testnet/contract/$ESCROW_VAULT_ID"
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

  escrow-vault)
    # Deploy EscrowVault only. Completely standalone — no dependency on
    # Registry, BillingCycle, or SpendPolicy. This is what `npm run deploy:escrow-vault` runs.
    deploy_and_init_escrow_vault
    print_output
    ;;

  *)
    echo "Unknown mode: $MODE"
    echo "Valid modes: core | spend-policy | escrow-vault"
    echo ""
    echo "Usage:"
    echo "  npm run deploy                (core: Registry + BillingCycle)"
    echo "  npm run deploy:spend-policy   (SpendPolicy only)"
    echo "  npm run deploy:escrow-vault   (EscrowVault only)"
    exit 1
    ;;

esac
