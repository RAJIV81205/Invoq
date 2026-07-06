"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeactivateButton({ planId, active }: { planId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const path = active
        ? `/api/plans/${planId}`
        : `/api/plans/${planId}/reactivate`;
      const res = await fetch(path, { method: active ? "DELETE" : "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d?.error ?? "Failed");
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className="button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {active ? "Deactivate" : "Reactivate"}
      </button>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </div>
  );
}
