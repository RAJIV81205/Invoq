"use client";

import { useState } from "react";
import Modal from "./Modal";

export default function SecretKeyModal({
  open,
  onClose,
  secret,
  title = "Save your secret key",
  description = "This key will only be shown once. Store it in a secure location — you cannot recover it later.",
}: {
  open: boolean;
  onClose: () => void;
  secret: string;
  title?: string;
  description?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  function copy() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <p className="text-sm text-[var(--muted)] mb-4 leading-6">{description}</p>
      <div className="relative rounded-2xl border border-amber-400/20 bg-amber-400/6 p-4 font-mono text-sm break-all text-[var(--foreground)]">
        {secret}
        <button
          onClick={copy}
          className="absolute top-3 right-3 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-white/10 transition"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <label className="mt-4 flex items-center gap-3 text-sm text-[var(--foreground)]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-transparent"
        />
        I have stored this key in a secure location
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={!confirmed}
          className="button-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </Modal>
  );
}
