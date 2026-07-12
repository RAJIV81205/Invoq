"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import { getApiError, getErrorMessage } from "@/app/lib/errors";

export default function NewPlanButton({ stellarAddress }: { stellarAddress: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("29");
  const [intervalDays, setIntervalDays] = useState("30");
  const [trialDays, setTrialDays] = useState("0");
  const [usageLimit, setUsageLimit] = useState("0");
  const [features, setFeatures] = useState("api_access");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txInfo, setTxInfo] = useState<{ planId: string; txHash: string } | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      // Admin-signed create_plan_for — Invoq's backend pays the fee and signs.
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          developerAddress: stellarAddress,
          name,
          priceUsdc:        Math.round(Number(priceUsdc) * 10_000_000),
          intervalSeconds:  Number(intervalDays) * 86_400,
          trialSeconds:     Number(trialDays)   * 86_400,
          usageLimit:       Number(usageLimit),
          features:         features.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(getApiError(data, "Failed to create plan"));
        return;
      }

      setTxInfo({ planId: data.planId, txHash: data.txHash });
      router.refresh();
    } catch (e: unknown) {
      setErr(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setName(""); setPriceUsdc("29"); setIntervalDays("30");
    setTrialDays("0"); setUsageLimit("0"); setFeatures("api_access");
    setErr(null); setTxInfo(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="button-primary px-4 py-2 text-sm"
      >
        New plan
      </button>
      <Modal open={open} onClose={close} title="Create plan" size="lg">
        {txInfo ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--success)]">Plan created on-chain.</p>
            <div className="surface-soft rounded-2xl p-4 text-sm">
              <div><span className="text-[var(--muted)]">Plan ID:</span> <span className="font-mono">{txInfo.planId}</span></div>
              <div className="mt-1 break-all"><span className="text-[var(--muted)]">Tx hash:</span> <span className="font-mono text-xs">{txInfo.txHash}</span></div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={close}
                className="button-primary px-4 py-2 text-sm"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="API Pro"
                className="input-shell"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2">Price (USDC)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceUsdc}
                  onChange={(e) => setPriceUsdc(e.target.value)}
                  className="input-shell"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Interval (days)</label>
                <input
                  type="number"
                  min="1"
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                  className="input-shell"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Trial (days, 0 = none)</label>
                <input
                  type="number"
                  min="0"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="input-shell"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Usage limit (0 = unlimited)</label>
                <input
                  type="number"
                  min="0"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                  className="input-shell"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Features (comma-separated)</label>
              <input
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
                placeholder="api_access, webhooks, export"
                className="input-shell font-mono"
              />
            </div>
            {err && (
              <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-3 text-sm text-rose-200">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={close}
                className="button-secondary px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !name}
                className="button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Submitting…" : "Create plan"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
