import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(91,224,255,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(139,149,255,0.18),transparent_30%),linear-gradient(180deg,#050816_0%,#070b18_100%)]" />
      <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-6 py-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:px-8">
        <div className="hidden lg:block">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand)] via-[#8fb3ff] to-[var(--accent)] text-[0.68rem] font-black text-slate-950 shadow-lg shadow-cyan-500/20">
              IQ
            </div>
            <div>
              <div className="text-lg font-semibold tracking-[-0.03em]">Invoq</div>
              <div className="text-sm text-[var(--muted)]">Billing ops for Stellar</div>
            </div>
          </Link>
          <div className="mt-12 max-w-xl">
            <div className="eyebrow">Welcome in</div>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.06em] lg:text-6xl">
              Modern billing for the chain-native stack.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-[var(--muted)]">
              Sign in or create an account to manage plans, keys, webhooks, and usage from one clean
              dashboard.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="surface-soft rounded-[1.25rem] p-4">
                <div className="text-sm font-semibold">Fast setup</div>
                <div className="mt-1 text-sm text-[var(--muted)]">Live in minutes with a single secret key.</div>
              </div>
              <div className="surface-soft rounded-[1.25rem] p-4">
                <div className="text-sm font-semibold">Clean ops</div>
                <div className="mt-1 text-sm text-[var(--muted)]">One place for revenue, logs, and customers.</div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">{children}</div>
      </div>
    </div>
  );
}
