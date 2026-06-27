import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import WalletButton from "@/app/components/WalletButton";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(108,140,255,0.15),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,rgba(0,212,164,0.10),transparent_50%)]" />
          <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/60 px-3 py-1 text-xs text-[var(--muted)] mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              Built on Stellar · Powered by x402
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
              Programmable subscription billing
              <br />
              <span className="gradient-text">for the agentic internet</span>
            </h1>
            <p className="mt-6 mx-auto max-w-2xl text-lg text-[var(--muted)]">
              Invoq is the missing layer in Stellar&apos;s payment stack — managed recurring billing,
              usage metering, and prepaid escrow. Stripe Billing, but fully on-chain and
              programmable on Soroban.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="rounded-md bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition"
              >
                Start free
              </Link>
              <Link
                href="/dashboard"
                className="rounded-md border border-[var(--border)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--card)] transition"
              >
                Open dashboard
              </Link>
              <WalletButton />
            </div>
            <div className="mt-12 grid grid-cols-3 gap-6 text-sm text-[var(--muted)] max-w-xl mx-auto">
              <div>
                <div className="text-2xl font-semibold text-[var(--foreground)]">5s</div>
                finality
              </div>
              <div>
                <div className="text-2xl font-semibold text-[var(--foreground)]">~$0.00002</div>
                per renewal
              </div>
              <div>
                <div className="text-2xl font-semibold text-[var(--foreground)]">170+</div>
                off-ramp countries
              </div>
            </div>
          </div>
        </section>

        {/* Architecture */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-bold tracking-tight text-center">
            Four layers, one platform
          </h2>
          <p className="mt-3 text-center text-[var(--muted)] max-w-2xl mx-auto">
            Invoq composes directly on top of x402 and Soroban, increasing Stellar USDC
            volume without duplicating any existing work.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            {[
              { n: 4, t: "Developer Dashboard", d: "Next.js UI for revenue, customers, plans, and webhooks." },
              { n: 3, t: "API + SDKs",           d: "REST API + JS / Python SDKs. One function call per op." },
              { n: 2, t: "Subscription Engine",  d: "Postgres + Redis. Billing, metering, webhook delivery." },
              { n: 1, t: "Soroban Contracts",   d: "Four Rust contracts. Plans, cycles, policies, vaults." },
            ].map((l) => (
              <div key={l.n} className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 p-5">
                <div className="text-xs font-mono text-[var(--brand)] mb-1">Layer {l.n}</div>
                <h3 className="font-semibold mb-1">{l.t}</h3>
                <p className="text-sm text-[var(--muted)]">{l.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Use cases */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-3xl font-bold tracking-tight text-center">
            For every recurring-revenue product
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                title: "AI API platforms",
                desc:  "Tiered plans with per-token metering. Free, Pro, Enterprise — automatic renewals in USDC.",
                tag:   "usage-based",
              },
              {
                title: "SaaS subscriptions",
                desc:  "Monthly + annual plans, free trials, pause/resume, customer portal. Webhooks on every state change.",
                tag:   "flat-rate",
              },
              {
                title: "Marketplace + agents",
                desc:  "Prepaid escrow vaults for per-task billing. Top up once, draw down as agents spend.",
                tag:   "escrow",
              },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border border-[var(--border)] bg-[var(--card)]/70 p-6">
                <div className="text-xs uppercase tracking-wider text-[var(--brand)] font-medium mb-2">{c.tag}</div>
                <h3 className="text-lg font-semibold mb-2">{c.title}</h3>
                <p className="text-sm text-[var(--muted)]">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Code snippet */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-10">
            One function call per operation
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[#0d0d14] p-5">
              <div className="text-xs font-mono text-[var(--muted)] mb-3">Server SDK</div>
              <pre className="text-xs leading-relaxed text-zinc-200 overflow-x-auto"><code>{`import { InvoqServer } from "invoq-sdk/server";

const invoq = new InvoqServer({ apiKey: process.env.INVOQ_KEY! });

// Verify on every API request — cached in Redis (10s TTL)
const { entitled } = await invoq.entitlement.check(customer, "api:pro");

// Record usage (buffered in Redis, flushed to chain every 5s)
await invoq.usage.record(customer, tokensUsed);`}</code></pre>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[#0d0d14] p-5">
              <div className="text-xs font-mono text-[var(--muted)] mb-3">Browser SDK</div>
              <pre className="text-xs leading-relaxed text-zinc-200 overflow-x-auto"><code>{`import InvoqClient from "invoq-sdk/client";
import freighter from "@stellar/freighter-api";

const invoq = new InvoqClient({ apiKey: import.meta.env.VITE_INVOQ_KEY });
const wallet = { signTransaction: (xdr) => freighter.signTransaction(xdr, {...}) };

// One-shot: build, sign, submit
const { txHash } = await invoq.checkout.subscribe(wallet, customer, planId);`}</code></pre>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ship billing in an afternoon</h2>
          <p className="mt-3 text-[var(--muted)] max-w-xl mx-auto">
            No Solidity. No bridge. No Stripe. Just a REST API and a Soroban contract you can verify on Stellar Expert.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition"
            >
              Create an account
            </Link>
            <Link
              href="/test"
              className="rounded-md border border-[var(--border)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--card)] transition"
            >
              Try the test suite
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
