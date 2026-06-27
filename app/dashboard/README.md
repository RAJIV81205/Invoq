# Invoq Developer Dashboard

A Next.js 16 (App Router) admin UI for the Invoq subscription billing platform.

## Architecture

```
Browser ────> Next.js (this app) ──> /api/[...path] catch-all BFF ──> invoq-api (port 3001)
                                              │
                                              └─ reads invoq_session cookie
                                                 injects Authorization: Bearer sk_…
                                                 forwards the request + body
```

The `invoq_session` cookie carries the developer's secret API key. The BFF never exposes
it to the browser bundle, so the dashboard can safely call admin-only endpoints like
`GET /v1/subscriptions` and `POST /v1/plans`.

## Pages

- `/`              — landing page
- `/login`         — sign in (issues a fresh sk_ key)
- `/signup`        — create account + first sk_ key (shown once)
- `/dashboard`         — overview (MRR, ARR, active subs, recent activity)
- `/dashboard/plans`   — list, create, deactivate plans
- `/dashboard/plans/[planId]` — plan detail
- `/dashboard/customers`            — subscribers list
- `/dashboard/customers/[address]`  — subscription + history
- `/dashboard/usage`   — aggregated usage
- `/dashboard/vault`   — EscrowVault balances
- `/dashboard/webhooks` — endpoints + delivery log
- `/dashboard/keys`    — API key management
- `/dashboard/settings` — payout address
- `/test`      — Freighter-backed end-to-end test suite

## Auth flow

1. User signs up at `/signup` → frontend POSTs to `/api/developers/signup`.
2. The BFF forwards to the invoq-api, receives `{ secretKey, … }` back.
3. BFF sets the `invoq_session` HttpOnly cookie and strips the plaintext from the response.
4. The signup page also shows the secret key once in a copy-to-clipboard modal.
5. Every subsequent dashboard request goes through the BFF, which reads the cookie and
   injects the `Authorization: Bearer …` header.

## Configuration

`.env` (next to this README) must set:

```
INVOQ_API_URL=http://localhost:3001            # server-side (BFF)
NEXT_PUBLIC_INVOQ_API_URL=http://localhost:3001  # inlined into the client bundle
```

`middleware.ts` (renamed to `proxy.ts` in Next.js 16) gates `/dashboard/*` and redirects
unauthenticated users to `/login`.

## Conventions

- Server components fetch via `app/lib/auth-cookie.ts` (`getSession`, `requireSession`, `apiFetch`).
- Client components (modals, forms) are colocated in `app/dashboard/<page>/<Component>.tsx`.
- Shared UI primitives live in `app/components/`.
- All amounts are in USDC stroops on the wire (`1 USDC = 10_000_000`); `fmtUsdc()` in each
  page handles the conversion.
