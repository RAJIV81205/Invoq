"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SecretKeyModal from "@/app/components/SecretKeyModal";
import { getApiError, getErrorMessage } from "@/app/lib/errors";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [stellarAddress, setStellarAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/developers/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, stellarAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getApiError(data, "Signup failed"));
        return;
      }
      setSecretKey(data.secretKey);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onModalClose() {
    setSecretKey(null);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <div className="surface-strong w-full max-w-xl rounded-[2rem] p-7 sm:p-8">
        <div className="eyebrow">Create account</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">Start billing on Stellar.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Create plans, issue API keys, and manage webhook delivery from one dashboard. Your first
          secret key is shown only once.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-shell"
              placeholder="Your name or company"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-shell"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="stellar">
              Stellar wallet address
            </label>
            <input
              id="stellar"
              required
              value={stellarAddress}
              onChange={(e) => setStellarAddress(e.target.value)}
              className="input-shell font-mono"
              placeholder="G..."
              pattern="^G[0-9A-Z]{55}$"
              title="A 56-character Stellar G... address"
            />
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              This address owns your plans and receives revenue. It must already be funded on the target network.
            </p>
          </div>
          {error && (
            <div className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[var(--foreground)] hover:text-white">
            Sign in
          </Link>
        </p>
      </div>

      <SecretKeyModal
        open={secretKey !== null}
        onClose={onModalClose}
        secret={secretKey ?? ""}
        title="Your first API key"
        description="Copy this secret key now. It will only be shown once and is required for server-to-server requests to the Invoq API."
      />
    </>
  );
}
