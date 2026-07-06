"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import SecretKeyModal from "@/app/components/SecretKeyModal";

export default function NewKeyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function mint(type: "secret" | "publishable") {
    setBusy(true);
    setErr(null);
    try {
      const path = type === "secret" ? "/api/keys/secret" : "/api/keys/publishable";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data?.error ?? "Failed"); return; }
      setSecret(data.key);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setName(""); setErr(null); setSecret(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="button-primary px-4 py-2 text-sm"
      >
        New key
      </button>
      <Modal open={open} onClose={close} title="Mint new API key" size="lg">
        {secret ? (
          <SecretKeyModal
            open={true}
            onClose={close}
            secret={secret}
            title="Save your key"
            description="This is the only time the full key will be shown. Store it in your secret manager."
          />
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Name (optional)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. production-server"
                className="input-shell"
              />
            </div>
            {err && (
              <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-3 text-sm text-rose-200">{err}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={close} className="button-secondary px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => mint("publishable")}
                disabled={busy}
                className="button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "…" : "Create publishable (pk_)"}
              </button>
              <button
                onClick={() => mint("secret")}
                disabled={busy}
                className="button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "…" : "Create secret (sk_)"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
