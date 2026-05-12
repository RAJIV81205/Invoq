# invoq-sdk

Official JavaScript/TypeScript SDK for [Invoq](https://invoq.dev) — subscription billing infrastructure built on Stellar.

## Installation

```bash
npm install invoq-sdk
# or
pnpm add invoq-sdk
```

## Two imports, two use cases

| Import | Key type | Environment | Use for |
|---|---|---|---|
| `invoq-sdk/server` | `sk_live_...` | Node.js backend only | Plans, billing, usage, webhooks |
| `invoq-sdk/client` | `pk_live_...` | Browser / mobile | Wallet signing, tx submission |

---

## Server SDK

```typescript
import InvoqServer from "invoq-sdk/server";
import type { InvoqApiError } from "invoq-sdk/server";

const invoq = new InvoqServer({
  apiKey: process.env.INVOQ_SECRET_KEY!, // sk_live_...
  debug: process.env.NODE_ENV === "development",
});
```

### Plans

```typescript
// Create a plan
const { planId, txHash } = await invoq.plans.create({
  name: "Pro",
  priceUsdc: 29_000_000,     // 29 USDC (in stroops — 1 USDC = 10_000_000)
  intervalSeconds: 2592000,  // 30 days
  trialSeconds: 1209600,     // 14-day free trial
  usageLimit: 1_000_000,     // 1M units/period. 0 = unlimited
  features: ["api:pro", "rate:1000rps"],
});

// Get plan
const plan = await invoq.plans.get(planId);
console.log(plan.name, Number(plan.price_usdc) / 10_000_000, "USDC/period");

// Update plan (price change applies at next renewal)
await invoq.plans.update(planId, {
  name: "Pro",
  priceUsdc: 39_000_000, // price increase
  usageLimit: 2_000_000,
});

// Deactivate (existing subscribers keep access, new blocked)
await invoq.plans.deactivate(planId);

// Reactivate
await invoq.plans.reactivate(planId);
```

### Entitlement checks (hot path)

```typescript
// Simple boolean — fastest, use on every API request
const { entitled, source } = await invoq.entitlement.check(
  customerAddress, // Stellar G... address
  "api:pro",
);
// source: "cache" (Redis) or "chain" (Soroban query)

if (!entitled) {
  return res.status(403).json({ error: "Upgrade to Pro for access" });
}

// Even simpler — no try/catch needed, returns false for no-sub
const allowed = await invoq.entitlement.isAllowed(customerAddress, "api:pro");

// Full context — usage counters, plan ID, period end
const full = await invoq.entitlement.checkFull(customerAddress, "api:pro");
console.log(`${full.usage_current} / ${full.usage_limit} units used`);
```

### Usage metering

```typescript
// Record usage (buffered in Redis, flushed to chain every 5s)
await invoq.usage.record(customerAddress, 150); // 150 tokens

// Non-blocking fire-and-forget on hot path
void invoq.usage.record(customerAddress, tokensUsed);

// Get current usage stats
const usage = await invoq.usage.get(customerAddress);
console.log(usage.usageCurrent, "units used this period");
console.log(usage.status); // "Active" | "GracePeriod" | etc.
```

### Subscriptions

```typescript
// Get subscription status
const sub = await invoq.subscriptions.get(customerAddress);
console.log(sub.status);           // "Active"
console.log(sub.current_period_end); // unix timestamp as string

// Cancel at period end (default — customer keeps access until renewal date)
await invoq.subscriptions.cancel(customerAddress);

// Immediate cancellation — access revoked now
await invoq.subscriptions.cancel(customerAddress, true);
```

### Vault (EscrowVault / prepaid credits)

```typescript
// Get vault balance
const vault = await invoq.vault.get(customerAddress, developerAddress);
console.log(Number(vault.balance_usdc) / 10_000_000, "USDC remaining");

// Debit vault for usage (admin-signed, no customer action needed)
const { remainingBalance } = await invoq.vault.debit({
  customer: customerAddress,
  developer: developerAddress,
  amount: 5_000_000,              // 0.5 USDC
  usageDescription: "150 tokens",
});

// Close vault and refund customer
const { refunded } = await invoq.vault.close({
  caller: adminAddress,
  customer: customerAddress,
  developer: developerAddress,
});
```

### Webhooks

```typescript
// Register endpoint
const endpoint = await invoq.webhooks.create(
  "https://yourapp.com/webhooks/invoq",
  ["payment.renewed", "payment.failed", "subscription.cancelled"],
);
// Store endpoint.signingSecret securely — shown only once!

// List endpoints
const endpoints = await invoq.webhooks.list();

// Delete endpoint
await invoq.webhooks.delete(endpointId);

// View delivery log
const failures = await invoq.webhooks.log({ status: "failed", limit: 20 });
```

### Verifying incoming webhooks

```typescript
// Express — must use raw body middleware
app.post(
  "/webhooks/invoq",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event;
    try {
      event = invoq.webhooks.constructEvent(
        req.body,
        req.headers["x-invoq-signature"] as string,
        process.env.INVOQ_WEBHOOK_SECRET!,
      );
    } catch (err) {
      console.error("Webhook signature invalid:", err);
      return res.status(400).end();
    }

    switch (event.event) {
      case "payment.renewed":
        console.log("Renewal for customer:", event.data.customer);
        break;
      case "payment.failed":
        // Notify customer, potentially pause non-critical features
        break;
      case "subscription.cancelled":
        // Revoke access, send offboarding email
        break;
      case "vault.low_balance":
        // Email customer to top up
        break;
    }

    res.status(200).end();
  },
);

// Edge/browser runtime — use async version
const event = await invoq.webhooks.constructEventAsync(rawBody, sig, secret);
```

### Error handling

```typescript
import InvoqServer, { InvoqApiError, InvoqNetworkError, InvoqTimeoutError } from "invoq-sdk/server";

try {
  const sub = await invoq.subscriptions.get(customerAddress);
} catch (err) {
  if (err instanceof InvoqApiError) {
    switch (err.code) {
      case "NOT_FOUND_ERROR":
        console.log("No subscription found");
        break;
      case "AUTH_ERROR":
        console.error("Invalid API key");
        break;
      case "UPSTREAM_ERROR":
        // Stellar/Soroban call failed — retry safe
        console.error("Blockchain error:", err.message);
        break;
      case "RATE_LIMIT_ERROR":
        // Back off and retry
        break;
    }
    console.error("HTTP status:", err.statusCode);
    console.error("Raw body:", err.body);
  } else if (err instanceof InvoqNetworkError) {
    console.error("Network unreachable:", err.cause?.message);
  } else if (err instanceof InvoqTimeoutError) {
    console.error("Request timed out");
  }
}
```

---

## Client SDK

```typescript
import InvoqClient from "invoq-sdk/client";
import type { WalletAdapter } from "invoq-sdk/client";

const invoq = new InvoqClient({
  apiKey: import.meta.env.VITE_INVOQ_PUBLIC_KEY, // pk_live_...
  debug: import.meta.env.DEV,
});
```

### Wallet adapter

Implement the `WalletAdapter` interface for your wallet:

```typescript
// Freighter example
import freighter from "@stellar/freighter-api";

const wallet: WalletAdapter = {
  signTransaction: async (xdr) => {
    const result = await freighter.signTransaction(xdr, {
      network: "MAINNET",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    return result.signedXDR;
  },
};
```

### Subscribe to a plan

```typescript
// One-shot (recommended)
const { txHash } = await invoq.checkout.subscribe(wallet, customerAddress, planId);

// Step-by-step (if you need to inspect the XDR)
const { xdr } = await invoq.checkout.buildSubscribeTx(customerAddress, planId);
// xdr = unsigned transaction — pass to wallet
const signedXdr = await wallet.signTransaction(xdr);
// After wallet signs, submit
const { txHash } = await invoq.checkout.submitSubscription(signedXdr, customerAddress, planId);
```

### Create escrow vault

```typescript
const { txHash } = await invoq.checkout.createVault(wallet, {
  customerAddress,
  developerAddress: "GDEV...", // from your Invoq dashboard
  initialDeposit: 50_000_000,      // 5 USDC
  lowBalanceThreshold: 10_000_000, // 1 USDC → triggers vault.low_balance webhook
  autoTopupAmount: 50_000_000,     // suggested top-up hint
});
```

### Withdraw from vault

```typescript
const { txHash } = await invoq.checkout.withdraw(wallet, {
  customerAddress,
  developerAddress,
  amount: 20_000_000, // 2 USDC
});
```

### Check entitlement in UI

```typescript
// Gate UI features based on wallet's plan
const { entitled } = await invoq.entitlement.check(walletAddress, "feature:pro");
if (!entitled) showUpgradeBanner();

// Simple boolean
const canExport = await invoq.entitlement.isAllowed(walletAddress, "export:csv");
```

---

## TypeScript

Full TypeScript support. All types exported from each subpath:

```typescript
import type {
  Plan,
  Subscription,
  SubscriptionStatus,
  EntitlementResult,
  WebhookEvent,
  WebhookPayloadBase,
} from "invoq-sdk/server";

import type {
  WalletAdapter,
  BuildTxResult,
} from "invoq-sdk/client";
```

---

## Configuration

```typescript
const invoq = new InvoqServer({
  apiKey: "sk_live_...",

  // Optional: override API base URL (for self-hosted or staging)
  baseUrl: "https://api.your-invoq-instance.dev",

  // Optional: request timeout in ms (default: 30000)
  timeoutMs: 15_000,

  // Optional: log all requests and responses to console
  debug: true,
});
```

## Error codes

| Code | Meaning |
|---|---|
| `AUTH_ERROR` | Invalid, revoked, or missing API key (401) |
| `FORBIDDEN_ERROR` | Key type not allowed for this endpoint (403) |
| `NOT_FOUND_ERROR` | Resource does not exist (404) |
| `VALIDATION_ERROR` | Missing or invalid request params (400) |
| `RATE_LIMIT_ERROR` | Too many requests — back off (429) |
| `UPSTREAM_ERROR` | Stellar/Soroban call failed — retry safe (502) |
| `SERVER_ERROR` | Invoq backend error (500/503) |
| `NETWORK_ERROR` | No response received — DNS/connection issue |
| `TIMEOUT_ERROR` | Request exceeded `timeoutMs` |
| `SIGNATURE_ERROR` | Webhook HMAC verification failed |
| `PARSE_ERROR` | Response body is not valid JSON |