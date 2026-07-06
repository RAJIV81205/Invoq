"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerActions({ customerAddress, status }: { customerAddress: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, method: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/subscriptions/${customerAddress}${path}`, { method });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d?.error ?? "Action failed");
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const isPaused = status === "Paused";
  const isCancelled = status === "Cancelled" || status === "Expired";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {!isCancelled && !isPaused && (
          <button
            onClick={() => call("/pause", "POST")}
            disabled={busy}
            className="button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={() => call("/resume", "POST")}
            disabled={busy}
            className="button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            Resume
          </button>
        )}
        {!isCancelled && (
          <button
            onClick={() => call("?immediate=true", "DELETE")}
            disabled={busy}
            className="rounded-full border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-[var(--danger)]/15 disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </div>
  );
}
