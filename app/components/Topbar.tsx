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
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[rgba(5,8,22,0.7)] px-6 py-4 backdrop-blur-xl">
      <div>
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Workspace</div>
        <div className="text-sm text-[var(--foreground)]">
          Signed in as <span className="font-medium">{email}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-[var(--foreground)]">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_20px_rgba(67,242,186,0.75)]" />
          {short(stellarAddress)}
        </span>
        <button
          onClick={logout}
          className="button-secondary px-4 py-2 text-sm"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
