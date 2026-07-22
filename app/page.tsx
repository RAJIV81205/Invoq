import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import HeroBillingCard from "@/app/components/HeroBillingCard";

const layers = [
  {
    title: "Dashboard",
    desc: "A calm control room for plans, customers, usage, webhooks, and keys.",
  },
  {
    title: "API + SDKs",
    desc: "Server helpers and browser-safe keys for the billing flows you need.",
  },
  {
    title: "Engine",
    desc: "Redis, queues, and on-chain billing logic that stay out of your way.",
  },
  {
    title: "Contracts",
    desc: "Soroban primitives for subscriptions, vaults, policies, and renewals.",
  },
];

const useCases = [
  {
    title: "AI APIs",
    tag: "metered",
    desc: "Usage-based plans with automatic renewals and delivery logs you can trust.",
  },
  {
    title: "SaaS",
    tag: "recurring",
    desc: "Trials, pauses, subscriptions, and customer flows built for clean operations.",
  },
  {
    title: "Agents",
    tag: "escrow",
    desc: "Prepaid vaults and spend-first workflows for products that move fast.",
  },
];

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="overflow-hidden">
        <section className="relative flex min-h-[100svh] overflow-hidden bg-[#0A0B0F] px-5 pb-8 pt-28 sm:px-6 sm:pt-32">
          <div className="hero-orb hero-orb-a" />
          <div className="hero-orb hero-orb-b" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_65%,#0A0B0F_100%)]" />

          <div className="relative mx-auto flex w-full max-w-[720px] flex-col items-center justify-center text-center">
            <div className="hero-reveal inline-flex items-center gap-2 rounded-full border border-[rgba(108,92,231,0.24)] bg-[rgba(19,21,28,0.68)] px-3 py-1.5 font-data text-[0.66rem] text-[var(--muted)] shadow-[0_0_24px_rgba(108,92,231,0.08)] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-glow)] shadow-[0_0_9px_var(--brand-glow)]" />
              Built on x402 · Soroban · Stellar USDC
            </div>

            <h1 className="hero-reveal mt-5 max-w-[720px] text-[2.8rem] font-semibold leading-[0.98] tracking-[-0.045em] text-[var(--foreground)] sm:text-6xl lg:text-[4.5rem]" style={{ animationDelay: "70ms" }}>
              Infrastructure for <span className="gradient-text">programmable subscription billing.</span>
            </h1>

            <p className="hero-reveal mt-5 max-w-[60ch] text-base leading-7 text-[var(--muted)] sm:text-lg sm:leading-8" style={{ animationDelay: "140ms" }}>
              Launch recurring and usage-based payments on Stellar with one API and settlement your customers can verify.
            </p>

            <div className="hero-reveal mt-7 flex flex-col gap-3 sm:flex-row sm:gap-4" style={{ animationDelay: "210ms" }}>
              <Link href="/signup" className="button-primary min-h-11 min-w-36 rounded-[10px] px-5">Start building</Link>
              <Link href="/dashboard" className="button-secondary min-h-11 min-w-36 rounded-[10px] px-5">Explore dashboard</Link>
            </div>

            <div className="mt-8 w-full sm:mt-10">
              <HeroBillingCard />
            </div>

            <div className="hero-reveal mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-data text-[0.62rem] uppercase tracking-[0.14em] text-[var(--muted-deep)]" style={{ animationDelay: "350ms" }}>
              <span>Powering AI billing on Stellar</span><span className="hidden h-px w-6 bg-[var(--border)] sm:block" /><span>5-second finality</span><span className="hidden h-px w-6 bg-[var(--border)] sm:block" /><span>USDC native</span>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:py-20">
          <div className="grid gap-4 md:grid-cols-4">
            {layers.map((layer, idx) => (
              <div key={layer.title} className="surface rounded-[1.5rem] p-5">
                <div className="text-xs font-mono text-[var(--brand-glow)]">0{idx + 1}</div>
                <h2 className="mt-3 text-lg font-semibold tracking-[-0.03em]">{layer.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{layer.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-12 sm:px-6 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <div className="eyebrow">Use cases</div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              One stack for every billing shape
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--muted)]">
              Flat-rate plans, metered APIs, or vault-backed spend. The primitives stay simple.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {useCases.map((item) => (
              <div key={item.title} className="surface rounded-[1.5rem] p-6">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--brand-glow)]">{item.tag}</div>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-12 sm:px-6 lg:py-20">
          <div className="surface-strong grid gap-8 rounded-[2rem] p-6 lg:grid-cols-[0.9fr_1.1fr] lg:p-8">
            <div>
              <div className="eyebrow">Developer first</div>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
                One function call per operation.
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">
                Invoq keeps the API surface thin. The product does the coordination so your app can
                stay focused on shipping.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/test" className="button-secondary">
                  Try the test suite
                </Link>
                <Link href="/signup" className="button-primary">
                  Create account
                </Link>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[1.25rem] border border-white/10 bg-[rgba(2,8,23,0.7)] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Server SDK</div>
                <pre className="mt-4 overflow-x-auto text-xs leading-6 text-slate-200">
                  <code>{`const invoq = new InvoqServer({ apiKey: process.env.INVOQ_KEY! });
await invoq.entitlement.check(customer, "api:pro");
await invoq.usage.record(customer, tokensUsed);`}</code>
                </pre>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-[rgba(2,8,23,0.7)] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Browser SDK</div>
                <pre className="mt-4 overflow-x-auto text-xs leading-6 text-slate-200">
                  <code>{`const invoq = new InvoqClient({ apiKey: import.meta.env.VITE_INVOQ_KEY });
await invoq.checkout.subscribe(wallet, customer, planId);`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
