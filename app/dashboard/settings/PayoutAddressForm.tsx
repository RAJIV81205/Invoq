"use client";

import { useState } from "react";

export default function PayoutAddressForm({ initial, isValid }: { initial: string; isValid: boolean }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch("/api/developers/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutAddress: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d?.error ?? "Failed");
        return;
      }
      setOk(true);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        pattern="^G[0-9A-Z]{55}$"
        className="input-shell font-mono"
      />
      {!isValid && value && (
        <p className="text-xs text-rose-400">Address must be a 56-character Stellar G... address.</p>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {ok  && <p className="text-xs text-emerald-400">Saved.</p>}
      <button
        onClick={save}
        disabled={busy || !value.startsWith("G")}
        className="button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
