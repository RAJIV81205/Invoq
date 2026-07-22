"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/",          label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/test",      label: "Test Suite" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 w-full px-4 pt-4 sm:px-5 sm:pt-5">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-[rgba(5,8,22,0.58)] px-4 py-3 shadow-2xl shadow-slate-950/20 backdrop-blur-2xl sm:px-5">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-glow)] text-[0.7rem] font-black text-white shadow-lg shadow-violet-500/20 glow">
            IQ
          </div>
          <span className="text-lg font-semibold tracking-[-0.03em]">Invoq</span>
        </Link>

        <div className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          {links.map((l) => {
            const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[rgba(255,255,255,0.08)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <Link
            href="/login"
            className="button-ghost px-4 py-2"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="button-primary px-4 py-2 text-sm"
          >
            Sign up
          </Link>
        </div>

        <button
          className="md:hidden p-2 text-[var(--muted)]"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-white/10 px-6 py-4 flex flex-col gap-2 bg-[rgba(5,8,22,0.92)]">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--muted)]">Log in</Link>
          <Link href="/signup" className="rounded-xl px-3 py-2 text-sm font-semibold text-[var(--foreground)]">Sign up</Link>
        </div>
      )}
    </nav>
  );
}
