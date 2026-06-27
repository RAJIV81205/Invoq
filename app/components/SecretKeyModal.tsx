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
      <p className="text-sm text-[var(--muted)] mb-4">{description}</p>
      <div className="relative rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 font-mono text-sm break-all">
        {secret}
        <button
          onClick={copy}
          className="absolute top-2 right-2 rounded-md bg-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--card)] transition"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)] bg-[var(--background)]"
        />
        I have stored this key in a secure location
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={!confirmed}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </Modal>
  );
}
