"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import SecretKeyModal from "@/app/components/SecretKeyModal";

const ALL_EVENTS = [
  "subscription.created",
  "subscription.cancelled",
  "payment.renewed",
  "payment.failed",
  "payment.retry_succeeded",
  "usage.threshold",
  "trial.ending",
  "vault.created",
  "vault.low_balance",
];

export default function NewEndpointButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  function toggle(ev: string) {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  }

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? "Failed to create endpoint");
        return;
      }
      setSecret(data.signingSecret);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setUrl(""); setEvents([]); setErr(null); setSecret(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition"
      >
        Add endpoint
      </button>

      <Modal open={open} onClose={close} title="Register webhook endpoint" size="lg">
        {secret ? (
          <SecretKeyModal
            open={true}
            onClose={close}
            secret={secret}
            title="Save your signing secret"
            description="Use this to verify X-Invoq-Signature HMAC-SHA256 of the raw request body in your handler."
          />
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">URL (HTTPS)</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourapp.com/webhooks/invoq"
                className="w-full rounded-md bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Events (empty = all)</label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-3">
                {ALL_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm font-mono cursor-pointer">
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={() => toggle(ev)}
                      className="h-3.5 w-3.5 rounded border-[var(--border)]"
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
            {err && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={close} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">Cancel</button>
              <button
                onClick={submit}
                disabled={busy || !url.startsWith("https://")}
                className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Creating…" : "Create endpoint"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
