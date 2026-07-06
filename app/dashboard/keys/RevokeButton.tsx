"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RevokeButton({ keyId }: { keyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function revoke() {
    if (!confirm("Revoke this key? This cannot be undone.")) return;
    setBusy(true);
    try {
      await fetch(`/api/keys/${keyId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={revoke}
      disabled={busy}
      className="rounded-full border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-[var(--danger)]/15 disabled:opacity-60"
    >
      {busy ? "Revoking…" : "Revoke"}
    </button>
  );
}
