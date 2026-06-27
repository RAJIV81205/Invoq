"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SecretKeyModal from "@/app/components/SecretKeyModal";

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
        setError(data?.error ?? "Signup failed");
        return;
      }
      setSecretKey(data.secretKey);
    } catch (err: any) {
      setError(err?.message ?? "Network error");
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
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Sign up to issue API keys, define plans, and start billing on Stellar. The first secret key is shown once.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="name">Name</label>
            <input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
              placeholder="Your name or company"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="stellar">
              Stellar wallet address
            </label>
            <input
              id="stellar"
              required
              value={stellarAddress}
              onChange={(e) => setStellarAddress(e.target.value)}
              className="w-full rounded-md bg-[var(--background)] border border-[var(--border)] px-3 py-2 text-sm font-mono focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
              placeholder="G..."
              pattern="^G[0-9A-Z]{55}$"
              title="A 56-character Stellar G... address"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              This wallet will own your plans and receive subscription revenue. It must already be funded on the target network.
            </p>
          </div>
          {error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[var(--brand)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--brand-glow)] transition disabled:opacity-60"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-[var(--muted)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--brand)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <SecretKeyModal
        open={secretKey !== null}
        onClose={onModalClose}
        secret={secretKey ?? ""}
        title="Your first API key"
        description="Copy this secret key now — it is shown only once. We use it to authenticate server-to-server requests to the Invoq API on your behalf."
      />
    </>
  );
}
