"use client";

import { useState } from "react";
import { connectFreighter, getFreighterAddress } from "@/lib/freighter";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Failed to connect wallet";
}

export default function WalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      await connectFreighter();
      const addr = await getFreighterAddress();
      setAddress(addr);
    } catch (err: unknown) {
      setErr(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function short(a: string) {
    return `${a.slice(0, 6)}…${a.slice(-6)}`;
  }

  if (address) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-mono text-[var(--foreground)]">
        <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_20px_rgba(67,242,186,0.7)]" />
        {short(address)}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={connect}
        disabled={busy}
        className="button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Connecting…" : "Connect Wallet"}
      </button>
      {err && <span className="text-xs text-[var(--danger)]">{err}</span>}
    </div>
  );
}
