"use client";

import { useRouter } from "next/navigation";

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

export default function Topbar({
  stellarAddress,
  email,
}: {
  stellarAddress: string;
  email: string;
}) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-[var(--border)] bg-[rgba(10,11,15,0.82)] px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <div className="md:hidden grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] font-data text-[0.6rem] font-bold">IQ</div>
        <div>
          <div className="text-[0.64rem] uppercase tracking-[0.16em] text-[var(--muted-deep)]">Production workspace</div>
          <div className="text-xs text-[var(--muted)]">{email}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-2 rounded-[9px] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 font-data text-xs text-[var(--foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]" />
          {short(stellarAddress)}
        </span>
        <button
          onClick={logout}
          className="button-secondary px-3.5 py-1.5 text-xs"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
