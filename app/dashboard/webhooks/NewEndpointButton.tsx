"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import SecretKeyModal from "@/app/components/SecretKeyModal";
import { getApiError, getErrorMessage } from "@/app/lib/errors";

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
        setErr(getApiError(data, "Failed to create endpoint"));
        return;
      }
      setSecret(data.signingSecret);
      router.refresh();
    } catch (e: unknown) {
      setErr(getErrorMessage(e));
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
        className="button-primary px-4 py-2 text-sm"
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
              <label className="block text-sm font-medium mb-2">URL (HTTPS)</label>
              <input
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourapp.com/webhooks/invoq"
                className="input-shell font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Events (empty = all)</label>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/4 p-3">
                {ALL_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm font-mono cursor-pointer rounded-xl px-2 py-1.5 hover:bg-white/5">
                    <input
                      type="checkbox"
                      autoComplete="off"
                      checked={events.includes(ev)}
                      onChange={() => toggle(ev)}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
            {err && (
              <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-3 text-sm text-rose-200">
                {err}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={close} className="button-secondary px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={submit}
                disabled={busy || !url.startsWith("https://")}
                className="button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
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
