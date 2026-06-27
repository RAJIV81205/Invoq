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
      <span className="inline-flex items-center gap-2 rounded-md bg-[var(--card)] border border-[var(--border)] px-3 py-1.5 text-sm font-mono">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        {short(address)}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={connect}
        disabled={busy}
        className="rounded-md bg-[var(--brand)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition disabled:opacity-60"
      >
        {busy ? "Connecting…" : "Connect Wallet"}
      </button>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </div>
  );
}
