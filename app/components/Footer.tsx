import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--border)]">
      <div className="mx-auto max-w-7xl px-6 py-10 grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[var(--brand)] to-[var(--accent)] text-white font-bold text-xs">
              IQ
            </div>
            <span className="font-semibold">Invoq</span>
          </div>
          <p className="text-sm text-[var(--muted)] max-w-sm">
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
      <div className="border-t border-[var(--border)] py-5 text-center text-xs text-[var(--muted)]">
        © {new Date().getFullYear()} Invoq · Built on Stellar
      </div>
    </footer>
  );
}
