import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import WalletButton from "@/app/components/WalletButton";

const stats = [
  { value: "5s", label: "finality" },
  { value: "~$0.00002", label: "per renewal" },
  { value: "170+", label: "off-ramp countries" },
];

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
        <section
          className="relative min-h-screen overflow-hidden bg-black"
          style={{ height: "100dvh" }}
        >
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_18%,rgba(91,224,255,0.16),transparent_24%),radial-gradient(circle_at_82%_22%,rgba(139,149,255,0.18),transparent_25%),radial-gradient(circle_at_68%_76%,rgba(67,242,186,0.12),transparent_22%)]" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(4,8,20,0.3)_0%,rgba(4,8,20,0.72)_100%)]" />

          <div className="mx-auto flex min-h-screen max-w-7xl flex-col justify-between gap-10 px-5 pb-8 pt-28 sm:px-6 sm:pb-10 lg:pb-12 lg:pt-32">
            <div className="grid flex-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="max-w-3xl">
                <div className="eyebrow">Built on Stellar and Soroban</div>
                <h1 className="mt-5 text-5xl font-semibold tracking-[-0.07em] text-white sm:text-7xl md:text-8xl">
                  Billing that
                  <span className="font-playfair italic font-normal tracking-[-0.05em]"> feels</span>
                  <span className="block -mt-2 sm:-mt-3">native to chain.</span>
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-8 text-white/78 sm:text-lg">
                  Invoq gives teams recurring billing, usage metering, prepaid escrow, and a polished
                  dashboard without leaving Stellar.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/signup" className="button-primary">
                    Start free
                  </Link>
                  <Link href="/dashboard" className="button-secondary">
                    Open dashboard
                  </Link>
                  <WalletButton />
                </div>
              </div>

              <div className="relative">
                <div className="absolute -inset-8 rounded-[3rem] bg-[radial-gradient(circle,rgba(91,224,255,0.2),transparent_60%)] blur-3xl" />
                <div className="surface-strong relative overflow-hidden rounded-[2.25rem] p-6 sm:p-7">
                  <div className="flex items-center justify-between border-b border-white/10 pb-5">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Billing pulse</div>
                      <div className="mt-1 text-2xl font-semibold tracking-[-0.05em]">$128.4k MRR</div>
                    </div>
                    <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                      Healthy
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {layers.slice(0, 2).map((layer) => (
                      <div key={layer.title} className="surface-soft rounded-[1.25rem] p-4">
                        <div className="text-sm font-semibold tracking-[-0.03em]">{layer.title}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{layer.desc}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-[rgba(2,8,23,0.55)] p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--muted)]">Renewals today</span>
                      <span className="font-semibold text-[var(--accent)]">+18.4%</span>
                    </div>
                    <div className="mt-4 grid grid-cols-7 gap-2">
                      {[36, 52, 42, 58, 46, 72, 64].map((h, i) => (
                        <div key={i} className="flex h-28 items-end">
                          <div
                            className="w-full rounded-t-xl bg-gradient-to-t from-[var(--brand)] via-[#91b3ff] to-[var(--accent)]"
                            style={{ height: `${h}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 text-white/80 sm:grid-cols-3">
              {stats.map((item) => (
                <div key={item.label} className="surface-soft rounded-[1.5rem] p-4">
                  <div className="text-2xl font-semibold tracking-[-0.05em] text-white">{item.value}</div>
                  <div className="text-sm text-white/70">{item.label}</div>
                </div>
              ))}
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
