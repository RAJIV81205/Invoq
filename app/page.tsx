import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import Footer from "@/app/components/Footer";
import HeroBillingCard from "@/app/components/HeroBillingCard";
import LivePlatformStats from "@/app/components/LivePlatformStats";

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

function BoltIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />
    </svg>
  );
}

function OrbitIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="2.4" />
      <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(35 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(-35 12 12)" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.5 6.5A7.8 7.8 0 0 0 4.7 9L3 11m0 0 1.2-4M3 11l4-1.2M6.5 17.5A7.8 7.8 0 0 0 19.3 15l1.7-2m0 0-1.2 4M21 13l-4 1.2" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10 8 4 4-4 4" />
    </svg>
  );
}

function StellarGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="16" cy="16" r="8.7" />
      <path strokeLinecap="round" d="M5 20.2 27 10.9M5.2 15.9l21.6-9.1M8.4 25.5l15.2-6.4" />
    </svg>
  );
}

function CoinField() {
  return (
    <div className="invoq-coin-field" aria-hidden="true">
      <span className="invoq-coin invoq-coin-a"><StellarGlyph /></span>
      <span className="invoq-coin invoq-coin-b"><b>$</b></span>
      <span className="invoq-coin invoq-coin-c"><StellarGlyph /></span>
      <span className="invoq-coin invoq-coin-d"><b>USDC</b></span>
      <span className="invoq-coin invoq-coin-e"><StellarGlyph /></span>
      <span className="invoq-coin invoq-coin-f"><b>$</b></span>
      <span className="invoq-orbit invoq-orbit-a" />
      <span className="invoq-orbit invoq-orbit-b" />
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="invoq-landing">
      <div className="invoq-hero-shell">
        <div className="invoq-sky" aria-hidden="true">
          <div className="invoq-aurora invoq-aurora-one" />
          <div className="invoq-aurora invoq-aurora-two" />
          <div className="invoq-grid-plane" />
          <div className="invoq-grain" />
        </div>
        <CoinField />
        <Navbar />

        <section className="invoq-hero" aria-labelledby="hero-title">
          <div className="invoq-hero-inner">
            <div className="invoq-hero-badge invoq-fade-up">
              <span /> Built on x402 · Soroban · Stellar USDC
            </div>
            <h1 id="hero-title" className="invoq-hero-title invoq-fade-up" style={{ "--delay": "70ms" } as React.CSSProperties}>
              <span>
                Billing <span className="invoq-inline-icon"><BoltIcon /></span> built for products
              </span>
              <span>
                that move onchain <span className="invoq-inline-icon"><OrbitIcon /></span>
              </span>
            </h1>

            <p className="invoq-hero-copy invoq-fade-up" style={{ "--delay": "150ms" } as React.CSSProperties}>
              Launch recurring and usage-based payments on Stellar with one API and settlement your
              customers can verify.
            </p>

            <div className="invoq-hero-actions invoq-fade-up" style={{ "--delay": "230ms" } as React.CSSProperties}>
              <Link href="/signup" className="invoq-hero-cta">
                <span>Start building</span>
                <ArrowIcon />
              </Link>
              <Link href="/dashboard" className="invoq-hero-secondary">Explore dashboard</Link>
            </div>

            <div className="invoq-hero-card-wrap">
              <HeroBillingCard />
            </div>

            <div className="invoq-proof invoq-fade-up" style={{ "--delay": "430ms" } as React.CSSProperties}>
              <span className="invoq-proof-icon"><LoopIcon /></span>
              <span>Powering AI billing on Stellar</span>
              <i />
              <span>5-second finality</span>
              <i />
              <span>USDC native</span>
            </div>
          </div>
        </section>
      </div>

      <div className="invoq-page-body">
        <section className="invoq-section invoq-stack-section" aria-labelledby="stack-heading">
          <div className="invoq-section-heading">
            <div className="invoq-kicker">The stack</div>
            <h2 id="stack-heading">Everything billing needs.<br />Nothing it doesn&apos;t.</h2>
          </div>
          <div className="invoq-layer-grid">
            {layers.map((layer, index) => (
              <article key={layer.title} className="invoq-feature-card">
                <div className="invoq-feature-number">0{index + 1}</div>
                <h3>{layer.title}</h3>
                <p>{layer.desc}</p>
                <span className="invoq-feature-arrow" aria-hidden="true">↗</span>
              </article>
            ))}
          </div>
        </section>

        <section className="invoq-section" aria-labelledby="network-stats-heading">
          <div className="invoq-stats-shell">
            <LivePlatformStats />
          </div>
        </section>

        <section id="pricing" className="invoq-section invoq-use-section" aria-labelledby="use-cases-heading">
          <div className="invoq-section-heading invoq-section-heading-centered">
            <div className="invoq-kicker">Use cases</div>
            <h2 id="use-cases-heading">One stack for every billing shape</h2>
            <p>Flat-rate plans, metered APIs, or vault-backed spend. The primitives stay simple.</p>
          </div>
          <div className="invoq-use-grid">
            {useCases.map((item) => (
              <article key={item.title} className="invoq-use-card">
                <div className="invoq-use-tag">{item.tag}</div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="invoq-use-rail"><span /></div>
              </article>
            ))}
          </div>
        </section>

        <section id="docs" className="invoq-section">
          <div className="invoq-dev-panel">
            <div className="invoq-dev-copy">
              <div className="invoq-kicker">Developer first</div>
              <h2>One function call per operation.</h2>
              <p>
                Invoq keeps the API surface thin. The product does the coordination so your app can
                stay focused on shipping.
              </p>
              <div className="invoq-dev-actions">
                <Link href="/test" className="invoq-hero-secondary">Try the test suite</Link>
                <Link href="/signup" className="invoq-pill invoq-pill-primary">Create account</Link>
              </div>
            </div>
            <div className="invoq-code-stack">
              <div className="invoq-code-card">
                <div><span /> Server SDK</div>
                <pre><code>{`const invoq = new InvoqServer({ apiKey: process.env.INVOQ_KEY! });
await invoq.entitlement.check(customer, "api:pro");
await invoq.usage.record(customer, tokensUsed);`}</code></pre>
              </div>
              <div className="invoq-code-card invoq-code-card-offset">
                <div><span /> Browser SDK</div>
                <pre><code>{`const invoq = new InvoqClient({ apiKey: import.meta.env.VITE_INVOQ_KEY });
await invoq.checkout.subscribe(wallet, customer, planId);`}</code></pre>
              </div>
            </div>
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
