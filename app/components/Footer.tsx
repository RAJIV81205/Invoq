import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-white/10 bg-[rgba(3,7,19,0.45)]">
      <div className="mx-auto max-w-7xl px-6 py-12 grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand)] via-[#8fb3ff] to-[var(--accent)] text-[0.68rem] font-black text-slate-950 shadow-lg shadow-cyan-500/20">
              IQ
            </div>
            <span className="font-semibold tracking-[-0.03em]">Invoq</span>
          </div>
          <p className="text-sm text-[var(--muted)] max-w-md leading-6">
            Programmable subscription billing infrastructure for Stellar.
            Built on x402, Soroban, and Stellar USDC.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-sm mb-3">Product</h3>
          <ul className="space-y-2 text-sm text-[var(--muted)]">
            <li><Link href="/dashboard">Dashboard</Link></li>
            <li><Link href="/test">Test suite</Link></li>
            <li><Link href="/dashboard/plans">Plans</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-sm mb-3">Developers</h3>
          <ul className="space-y-2 text-sm text-[var(--muted)]">
            <li><Link href="/signup">Get an API key</Link></li>
            <li><a href="https://github.com/RAJIV81205/Invoq" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><Link href="/test">API reference</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-[var(--muted)]">
        © {new Date().getFullYear()} Invoq · Built on Stellar
      </div>
    </footer>
  );
}
