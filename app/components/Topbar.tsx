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
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)]/85 backdrop-blur px-6 py-3">
      <div className="text-sm text-[var(--muted)]">
        Signed in as <span className="text-[var(--foreground)] font-medium">{email}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-2 rounded-md bg-[var(--card)] border border-[var(--border)] px-3 py-1.5 text-sm font-mono">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {short(stellarAddress)}
        </span>
        <button
          onClick={logout}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--card)] transition"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
