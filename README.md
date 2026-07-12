# Invoq

> Programmable Subscription Billing Infrastructure for Stellar

Invoq is a production-ready subscription billing platform built on Soroban smart contracts and Stellar USDC.

For a practical setup and usage walkthrough, see [HOW_TO_USE.md](./HOW_TO_USE.md).

It enables developers, SaaS platforms, AI APIs, and agentic applications to implement:

- Recurring billing
- Usage metering
- Entitlement management
- Spend controls
- Prepaid escrow systems

Built on top of **x402**, **Soroban**, and **Stellar USDC**, Invoq provides the missing subscription and billing layer for the Stellar ecosystem.

---

# Why Invoq?

x402 solves **per-request payments**.

But modern SaaS and AI products still need:

- Monthly subscriptions
- Usage quotas
- Free trials
- Grace periods
- Billing automation
- Customer lifecycle management
- Enterprise spend controls

Invoq fills that gap.

Think:

> Stripe Billing — but fully on-chain and programmable on Stellar.

---

# Core Architecture

Invoq consists of four modular Soroban smart contracts:

| Contract | Responsibility |
|---|---|
| `SubscriptionRegistry` | Subscription plans, entitlements, usage state |
| `BillingCycle` | Recurring renewals, SAC billing automation |
| `SpendPolicy` | Enterprise spend limits and AI agent controls |
| `EscrowVault` | Prepaid balances and usage-based billing |

Each contract owns a separate domain and communicates via cross-contract calls.

---

# Features

## Subscription Billing

- Monthly & annual plans
- Free trials
- Grace periods
- Automatic renewals
- Plan upgrades & downgrades
- Usage-based billing
- Hybrid billing models
- Cancellation flows

---

## Usage Metering

- Real-time usage tracking
- Per-plan quotas
- Threshold alerts
- Metered API billing
- Usage rollover support

---

## Enterprise Spend Controls

- Daily spending caps
- Per-transaction limits
- Wallet allowlists
- AI agent budget enforcement
- OpenZeppelin smart account integration

---

## Escrow Billing

- Prepaid USDC balances
- Auto top-ups
- Low-balance alerts
- Real-time debit accounting
- Refundable unused balances

---

## Developer Experience

- REST API
- JavaScript / TypeScript SDK
- Next.js dashboard
- Webhooks
- Revenue analytics
- Usage analytics

---

# Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Rust + Soroban SDK |
| Backend | Node.js |
| Database | MongoDB |
| Cache Layer | Redis |
| Queue System | BullMQ |
| Dashboard | Next.js + TailwindCSS |
| Blockchain SDK | Stellar SDK |
| Infrastructure | Docker + Railway / Fly.io |

---

# Smart Contracts

# 1. SubscriptionRegistry

The on-chain source of truth for:

- Plans
- Subscriptions
- Entitlements
- Usage counters
- Feature flags

## Responsibilities

- Create and manage plans
- Store customer subscriptions
- Check feature access
- Track usage
- Handle subscription lifecycle

## Main Functions

```rust
initialize()
create_plan()
update_plan()
create_subscription()
check_entitlement()
get_subscription()
renew_subscription()
cancel_subscription()
increment_usage()
```

## Subscription States

```rust
Active
Trialing
Paused
GracePeriod
Cancelled
Expired
```

---

# 2. BillingCycle

Handles:

- Recurring billing
- Automated renewals
- Grace periods
- SAC USDC transfers
- Payment retries

## Responsibilities

- Process subscription renewals
- Trigger USDC SAC debits
- Handle failed payments
- Retry grace-period renewals
- Expire unpaid subscriptions

## Main Functions

```rust
initialize()
initiate_subscription()
process_renewals()
retry_failed_payment()
expire_grace_periods()
update_grace_period()
```

---

# 3. SpendPolicy

Enterprise-grade spending controls for AI agents.

## Features

- Daily spend caps
- Transaction limits
- Wallet allowlists
- Agent policy mapping
- OpenZeppelin smart account integration

## Main Functions

```rust
initialize()
create_policy()
check_spend()
record_spend()
update_policy()
deactivate_policy()
```

---

# 4. EscrowVault

The prepaid billing engine for usage-based APIs.

## Features

- USDC deposits
- Usage debiting
- Auto top-up support
- Low-balance notifications
- Refundable balances

## Main Functions

```rust
initialize()
create_vault()
deposit()
debit_vault()
withdraw()
update_threshold()
```

---

# System Architecture

```text
┌─────────────────────────────┐
│      Developer Dashboard    │
│      Next.js + Analytics    │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│        Backend Services     │
│     Node.js + Webhooks      │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│     Subscription Engine     │
│ MongoDB + Redis + Jobs      │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│     Soroban Smart Contracts │
│ Registry │ Billing │ Vault  │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│      Stellar + x402 + USDC  │
└─────────────────────────────┘
```

---

# Billing Flow

## 1. Developer Creates Plan

The developer defines:

- Pricing
- Billing interval
- Usage limits
- Feature flags
- Trial duration

The plan is stored on-chain in `SubscriptionRegistry`.

---

## 2. Customer Subscribes

The customer:

- Connects their Stellar wallet
- Approves USDC SAC allowance
- Initiates subscription

`BillingCycle` creates the subscription.

---

## 3. Entitlement Verification

On every API request:

```ts
checkEntitlement(customer, feature)
```

The backend verifies whether the customer has access.

---

## 4. Usage Metering

The backend records usage:

```ts
recordUsage(customer, units)
```

Usage counters are stored on-chain.

---

## 5. Automatic Renewal

At billing period expiry:

- `BillingCycle` debits customer USDC
- Subscription renews automatically
- Webhooks fire
- Usage resets

---

## 6. Failed Payments

If payment fails:

- Subscription enters `GracePeriod`
- Retry attempts begin
- Final expiration occurs after grace timeout

---

# Webhooks

Invoq emits signed webhooks for all major billing events.

## Supported Events

| Event | Description |
|---|---|
| `subscription.created` | Customer subscribed |
| `payment.renewed` | Renewal successful |
| `payment.failed` | Renewal failed |
| `subscription.cancelled` | Subscription cancelled |
| `subscription.upgraded` | Plan upgraded |
| `subscription.downgraded` | Plan downgraded |
| `usage.threshold` | Usage nearing limit |
| `trial.ending` | Trial ending soon |
| `vault.low_balance` | Escrow balance low |

---

# SDK

## JavaScript / TypeScript SDK

```bash
npm install invoq
```

Example:

```ts
import { Invoq } from "invoq"

const invoq = new Invoq({
  apiKey: process.env.INVOQ_API_KEY
})

await invoq.subscriptions.create({
  customer: walletAddress,
  planId: 1
})
```

---

# Security Model

- All subscription state stored on-chain
- USDC settlement via Stellar SAC
- Non-custodial architecture
- HMAC-signed webhooks
- Redis-backed entitlement caching
- Smart contract audits before mainnet
- Deterministic billing state machine

---

# Why Stellar?

Invoq leverages Stellar because of:

- Near-zero transaction costs
- 5-second finality
- Native USDC ecosystem
- Soroban smart contracts
- Global off-ramp support
- High throughput for recurring billing

---

# Target Users

Invoq is designed for:

- AI API developers
- SaaS builders
- Data providers
- Agent marketplaces
- MCP tool builders
- Developer tooling companies

---

# Example Use Cases

## AI API Platform

- Free tier
- Pro subscription
- Enterprise billing
- Token-based metering

---

## Agent Marketplace

- x402 pay-per-request
- Monthly subscription bundles
- Hybrid billing

---

## Enterprise Data Provider

- Escrow-based usage billing
- Monthly invoices
- Real-time balance tracking

---

# Getting Started

## 1. Deploy the contracts

```bash
# Build all four Soroban contracts
npm run compile

# Deploy to testnet (Registry + BillingCycle, then wires them together)
npm run deploy

# Optional: deploy SpendPolicy and EscrowVault
npm run deploy:spend-policy
npm run deploy:escrow-vault
```

The deploy script prints the contract addresses. Paste them into `invoq-api/.env` and `lib/config.ts` (see the "Contract addresses" section below).

## 2. Start the API

```bash
cd invoq-api
cp .env.example .env       # fill in MONGODB_URI, Redis config, admin key
bun install
bun run dev                # http://localhost:3001
```

Redis should be available locally on `127.0.0.1:6379` for cache, queues, and jobs.

In another terminal, smoke-test it:

```bash
API_KEY=sk_live_... CUSTOMER_ADDRESS=G... bash scripts/test-api.sh
```

## 3. Open the dashboard

```bash
cd ..                       # back to the repo root
bun install
cp .env.example .env        # fill in NEXT_PUBLIC_INVOQ_API_URL
bun run dev                 # http://localhost:3000
```

Visit:

- `http://localhost:3000`         — landing page
- `http://localhost:3000/signup`  — create a developer + receive your first secret API key
- `http://localhost:3000/login`   — sign in with the email you used
- `http://localhost:3000/dashboard` — overview, plans, customers, webhooks, usage, vault, API keys, settings
- `http://localhost:3000/test`    — end-to-end test suite (Freighter wallet required)

## 4. Use the SDK

```bash
npm install invoq-sdk
```

```typescript
import { InvoqServer } from "invoq-sdk/server";
const invoq = new InvoqServer({ apiKey: process.env.INVOQ_KEY! });
const { entitled } = await invoq.entitlement.check(customer, "api:pro");
```

The dashboard goes through a BFF (`app/api/[...path]/route.ts`) that injects the session's API key. Secret keys are never exposed to the browser.

## 5. Contract addresses

The repo ships with testnet addresses in `invoq-api/src/config.ts` and `lib/config.ts`. For your own deployment, replace the constants with the addresses your `npm run deploy` printed.

| Contract            | Testnet address |
| ------------------- | --------------- |
| SubscriptionRegistry | `CC5FVK42PNUGPQZRYDYW7EVRIQIW2GTNPF6TVMZBBVPCLLDMJZLKU3PF` |
| BillingCycle         | `CAR6HPIXMNI4B4GONOWCXLN2N7VHH45FEX7IM2JDARR7XZHETNVDUUOR` |
| SpendPolicy          | `CDTLW43XT55X5FZB3PPC5Y7UG6PSYC4LW3ZED23YIEIVDXVOT72QHFPG` |
| EscrowVault          | `CBANJOGMJZ3CAIHX45UWUTDUVXZIMUYOZPXNHYZLKKHZBQ5ZAR6L2LLO` |
| USDC SAC             | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

---

# API endpoints

The full REST surface is documented in `Invoq_Contract_Specification.md` and exercised by `scripts/test-api.sh`. Highlights:

- `POST /v1/developers/signup` & `POST /v1/developers/login` — self-custodied onboarding
- `GET  /v1/developers/me` & `PATCH /v1/developers/me` — developer profile
- `POST /v1/plans` (admin-signed) & `POST /v1/plans/build-tx` (developer-signed) — plan lifecycle
- `POST /v1/checkout/{build,submit}-tx` — subscription signup flow
- `GET  /v1/entitlement?customer=…&feature=…` — Redis-cached entitlement check
- `POST /v1/usage/record` — buffered usage metering
- `GET  /v1/subscriptions` & `GET /v1/subscriptions/:customer/history` — subscription state
- `POST /v1/subscriptions/:customer/pause` & `/resume` — lifecycle control
- `GET  /v1/vault/balances` — all vaults for the developer
- `POST /v1/vault/{build,submit}-deposit-tx` — customer deposits USDC
- `POST /v1/spend-policies` & `GET /v1/spend-policies/:owner` — enterprise budget policies
- `POST /v1/spend-policies/check` — public read-only gate
- `POST /v1/keys/{secret,publishable}` & `DELETE /v1/keys/:id` — API key management

Webhooks fired by the platform: `subscription.created`, `subscription.cancelled`, `payment.renewed`, `payment.failed`, `payment.retry_succeeded`, `usage.threshold`, `trial.ending`, `vault.created`, `vault.low_balance`.

---

# Development Roadmap

## Milestone 1

- Soroban contract core
- Testnet deployment
- Unit tests

---

## Milestone 2

- Backend services
- Metering layer
- Webhook system
- x402 integration

---

## Milestone 3

- Dashboard
- JavaScript SDK
- Documentation
- External integrations

---

## Milestone 4

- Security audit
- Mainnet launch
- Production deployment

---

# Vision

Invoq aims to become the default billing infrastructure layer for:

- AI-native businesses
- Agentic commerce
- SaaS on Stellar
- Usage-metered APIs
- Subscription-based developer tools

By combining:

- Soroban smart contracts
- Stellar USDC
- x402 payments
- Enterprise billing primitives

Invoq enables developers anywhere in the world to build globally accessible subscription businesses entirely on Stellar.

---

# License

MIT License

---

# Built With

- Soroban
- Stellar USDC
- x402
- Rust
- Node.js
- MongoDB
- Redis
- Next.js
- TailwindCSS

---

# Status

🚧 In Active Development
