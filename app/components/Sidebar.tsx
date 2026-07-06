"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/dashboard",         label: "Overview",  icon: "home" },
  { href: "/dashboard/plans",   label: "Plans",     icon: "plans" },
  { href: "/dashboard/customers", label: "Customers", icon: "users" },
  { href: "/dashboard/usage",   label: "Usage",     icon: "usage" },
  { href: "/dashboard/vault",   label: "Vault",     icon: "vault" },
  { href: "/dashboard/webhooks", label: "Webhooks", icon: "webhook" },
  { href: "/dashboard/keys",    label: "API Keys",  icon: "key" },
  { href: "/dashboard/settings", label: "Settings", icon: "cog" },
];

const ICONS: Record<string, React.ReactNode> = {
  home: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  plans: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
  users: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
  usage: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  vault: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />,
  webhook: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />,
  key: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />,
  cog: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
};

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-white/10 bg-[rgba(5,8,22,0.56)] backdrop-blur-xl">
      <div className="px-5 py-6 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand)] via-[#8fb3ff] to-[var(--accent)] text-[0.68rem] font-black text-slate-950 shadow-lg shadow-cyan-500/20">
            IQ
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[-0.02em]">Invoq</div>
            <div className="text-xs text-[var(--muted)]">Billing ops</div>
          </div>
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition ${
                active
                  ? "bg-white/8 text-[var(--foreground)] shadow-sm ring-1 ring-white/8"
                  : "text-[var(--muted)] hover:bg-white/4 hover:text-[var(--foreground)]"
              }`}
            >
              <svg className={`w-4 h-4 ${active ? "text-[var(--brand-glow)]" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {ICONS[item.icon]}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-4 text-xs text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--foreground)]">← Back to site</Link>
      </div>
    </aside>
  );
}
