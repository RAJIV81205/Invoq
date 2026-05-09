#!/bin/bash

set -e

########################################
# CONFIG
########################################

NETWORK="testnet"
SOURCE="mywallet"

REGISTRY_WASM="target/wasm32v1-none/release/subscription_registry.wasm"
BILLING_WASM="target/wasm32v1-none/release/billing_cycle.wasm"

USDC_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

GRACE_PERIOD="259200"

########################################
# GET ADMIN ADDRESS
########################################

ADMIN_ADDRESS=$(stellar keys address $SOURCE)

echo ""
echo "Admin Address: $ADMIN_ADDRESS"
echo ""

########################################
# DEPLOY REGISTRY
########################################

echo ""
echo "Deploying Subscription Registry..."
echo ""

REGISTRY_ID=$(stellar contract deploy \
  --wasm $REGISTRY_WASM \
  --source-account $SOURCE \
  --network $NETWORK \
  --alias subscription_registry)

echo ""
echo "Subscription Registry Deployed"
echo "Registry Contract ID: $REGISTRY_ID"
echo ""

########################################
# INITIALIZE REGISTRY  ← was missing
########################################

echo ""
echo "Initializing Subscription Registry..."
echo ""

stellar contract invoke \
  --id $REGISTRY_ID \
  --source-account $SOURCE \
  --network $NETWORK \
  -- initialize \
  --admin $ADMIN_ADDRESS \
  --usdc_sac $USDC_SAC

echo ""
echo "Subscription Registry Initialized"
echo ""

########################################
# DEPLOY BILLING CYCLE
########################################

echo ""
echo "Deploying Billing Cycle..."
echo ""

BILLING_ID=$(stellar contract deploy \
  --wasm $BILLING_WASM \
  --source-account $SOURCE \
  --network $NETWORK \
  --alias billing_cycle)

echo ""
echo "Billing Cycle Deployed"
echo "Billing Contract ID: $BILLING_ID"
echo ""

########################################
# INITIALIZE BILLING CONTRACT
########################################

echo ""
echo "Initializing Billing Cycle..."
echo ""

stellar contract invoke \
  --id $BILLING_ID \
  --source-account $SOURCE \
  --network $NETWORK \
  -- initialize \
  --admin $ADMIN_ADDRESS \
  --registry_id $REGISTRY_ID \
  --usdc_sac $USDC_SAC \
  --grace_period_seconds $GRACE_PERIOD

echo ""
echo "Billing Cycle Initialized"
echo ""

########################################
# GRANT OPERATOR RIGHTS
########################################

echo ""
echo "Granting operator rights..."
echo ""

stellar contract invoke \
  --id $REGISTRY_ID \
  --source-account $SOURCE \
  --network $NETWORK \
  -- set_operator \
  --operator $BILLING_ID

echo ""
echo "Operator rights granted"
echo ""

########################################
# OUTPUT
########################################

echo "======================================="
echo "DEPLOYMENT SUCCESSFUL"
echo "======================================="
echo ""
echo "Registry Contract:"
echo "$REGISTRY_ID"
echo ""
echo "Billing Contract:"
echo "$BILLING_ID"
echo ""