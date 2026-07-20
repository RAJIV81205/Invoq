# How To Use Invoq

This file is a practical guide for the current repo. It is based on the docs, scripts, and app/api/dashboard code in this workspace.

## What Invoq Is

Invoq is a Stellar billing stack with:

- A Next.js dashboard
- A Node/Express API service
- Soroban smart contracts
- A TypeScript SDK
- MongoDB for persistent app data
- Redis for cache, queues, and job state

It supports:

- Subscriptions
- Usage metering
- Webhooks
- API keys
- Vault / escrow flows
- Spend policy checks

## Repo Map

- `app/` - dashboard, landing page, auth, shared UI
- `invoq-api/` - backend API service
- `contracts/` - Soroban contracts
- `packages/invoq-sdk/` - client and server SDK
- `scripts/` - deploy and smoke-test scripts
- `lib/` - shared frontend helpers

## Quick Start

### 1. Install deps

```bash
bun install
cd invoq-api && bun install
cd ../packages/invoq-sdk && bun install
```

### 2. Configure env

Frontend `.env`:

```env
INVOQ_API_URL=http://localhost:3001
NEXT_PUBLIC_INVOQ_API_URL=http://localhost:3001
```

API `.env`:

```env
PORT=3001
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=
STELLAR_ADMIN_SECRET=
MONGODB_URI=mongodb://127.0.0.1:27017/invoq
MONGODB_DB=invoq
REDIS_URL=redis://127.0.0.1:6379
# or use local host/port directly:
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379
# REDIS_PASSWORD=
SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS=CC5FVK42PNUGPQZRYDYW7EVRIQIW2GTNPF6TVMZBBVPCLLDMJZLKU3PF
BILLING_CYCLE_CONTRACT_ADDRESS=CAR6HPIXMNI4B4GONOWCXLN2N7VHH45FEX7IM2JDARR7XZHETNVDUUOR
ESCROW_VAULT_CONTRACT_ADDRESS=CBANJOGMJZ3CAIHX45UWUTDUVXZIMUYOZPXNHYZLKKHZBQ5ZAR6L2LLO
SPEND_POLICY_CONTRACT_ADDRESS=CDTLW43XT55X5FZB3PPC5Y7UG6PSYC4LW3ZED23YIEIVDXVOT72QHFPG
USDC_SAC_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

## Run Locally

### Frontend

```bash
bun dev
```

### API

```bash
docker compose up -d mongo redis
cd invoq-api
bun run dev
```

### SDK package

```bash
cd packages/invoq-sdk
bun run build
bun run typecheck
```

## Main User Flows

### Sign up

1. Open `/signup`
2. Enter name, email, password, and Stellar wallet address
3. Save the secret key shown in the modal
4. You land in `/dashboard`

### Sign in

1. Open `/login`
2. Enter email and password used for signup
3. The app refreshes the session and sends you to the dashboard

### Create a plan

1. Open `/dashboard/plans`
2. Click `New plan`
3. Fill name, price, interval, trial, usage limit, and features
4. Submit and confirm the on-chain result

### Manage customers

1. Open `/dashboard/customers`
2. Open a customer row
3. Pause, resume, or cancel the subscription

### Manage keys

1. Open `/dashboard/keys`
2. Mint secret or publishable keys
3. Revoke old keys when needed

### Webhooks

1. Open `/dashboard/webhooks`
2. Add an HTTPS endpoint
3. Select the events you want
4. Save the signing secret somewhere safe

### Usage and vault

- `/dashboard/usage` shows consumption totals
- `/dashboard/vault` shows prepaid balances and debits

### Settings

- `/dashboard/settings` shows the developer profile
- Update payout address there

## Dashboard Pages

- `/` - landing page
- `/dashboard` - overview
- `/dashboard/plans` - plan list and creation
- `/dashboard/plans/[planId]` - plan details
- `/dashboard/customers` - subscriber list
- `/dashboard/customers/[customerAddress]` - subscriber details and history
- `/dashboard/usage` - usage summary
- `/dashboard/vault` - vault balances
- `/dashboard/webhooks` - webhook endpoints and delivery log
- `/dashboard/keys` - API key management
- `/dashboard/settings` - developer settings
- `/test` - local test suite page

## API Areas

The backend routes are grouped by domain:

- `/v1/developers` - signup, login, profile
- `/v1/keys` - key minting and revocation
- `/v1/plans` - plan CRUD
- `/v1/subscriptions` - subscription lifecycle
- `/v1/usage` - usage recording and reporting
- `/v1/webhooks` - endpoint management and logs
- `/v1/vault` - vault balances and actions
- `/v1/spend-policies` - spend checks and policy lifecycle
- `/v1/checkout` - transaction builders
- `/v1/entitlement` - entitlement checks

## Contracts

Deploy contracts in this order:

1. `SubscriptionRegistry`
2. `BillingCycle`
3. `SpendPolicy`
4. `EscrowVault`

Useful commands:

```bash
bun run compile
bun run deploy
bun run deploy:spend-policy
bun run deploy:escrow-vault
```

## Smoke Tests

### Full repo smoke

```bash
bun run test
```

### API smoke

```bash
bash scripts/test-api.sh
```

### Contract smoke

```bash
bash scripts/test.sh
```

## Deploy

### API deploy flow

1. Build the API
2. Start it with PM2
3. Put Nginx in front of it
4. Add SSL

See `invoq-api/FIRST_TIME_SETUP.md` for the full VPS flow.

### Contract deploy flow

```bash
bun run compile
bun run deploy
```

If you deploy standalone contracts:

```bash
bun run deploy:spend-policy
bun run deploy:escrow-vault
```

## Important Files

- `README.md` - project overview
- `Invoq_Project_Documentation.md` - grant / product docs
- `Invoq_Contract_Specification.md` - contract reference
- `app/lib/auth-cookie.ts` - dashboard auth helpers
- `app/api/[...path]/route.ts` - dashboard BFF proxy
- `invoq-api/src/app.ts` - API entry and route wiring
- `invoq-api/src/lib/db/index.ts` - MongoDB access
- `invoq-api/src/lib/cache/redis.ts` - Redis cache and queue config
- `invoq-api/src/services/billing.ts` - billing orchestration
- `invoq-api/src/services/metering.ts` - usage accounting
- `packages/invoq-sdk/server/*` - server SDK
- `packages/invoq-sdk/client/*` - browser SDK

## Common Environment Variables

Frontend:

- `INVOQ_API_URL`
- `NEXT_PUBLIC_INVOQ_API_URL`

API:

- `PORT`
- `STELLAR_NETWORK`
- `STELLAR_RPC_URL`
- `STELLAR_ADMIN_SECRET`
- `MONGODB_URI`
- `MONGODB_DB`
- `REDIS_URL`
- `SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS`
- `BILLING_CYCLE_CONTRACT_ADDRESS`
- `ESCROW_VAULT_CONTRACT_ADDRESS`
- `SPEND_POLICY_CONTRACT_ADDRESS`

## Notes

- Use MongoDB instead of Drizzle in the API.
- Use local Redis instead of any hosted Redis provider in the API.
- Keep contracts unchanged unless a contract spec change is required.
- The dashboard expects the API to be running and reachable through the BFF.
