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
      className="text-xs text-rose-400 hover:underline disabled:opacity-60"
    >
      {busy ? "Revoking…" : "Revoke"}
    </button>
  );
}
