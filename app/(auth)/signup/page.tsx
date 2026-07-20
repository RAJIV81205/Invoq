"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SecretKeyModal from "@/app/components/SecretKeyModal";
import { getApiError, getErrorMessage } from "@/app/lib/errors";
import { connectFreighter, getFreighterAddress } from "@/lib/freighter";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [stellarAddress, setStellarAddress] = useState("");
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (password.length < 12 || password.length > 256) {
        setError("Password must be 12-256 characters");
        return;
      }
      if (!stellarAddress) {
        setError("Connect your Stellar wallet before creating an account");
        return;
      }
      const res = await fetch("/api/developers/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, stellarAddress, password }),
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

  async function connectWallet() {
    setError(null);
    setConnectingWallet(true);
    try {
      await connectFreighter();
      setStellarAddress(await getFreighterAddress());
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setConnectingWallet(false);
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
          Create plans, issue API keys, and manage webhook delivery from one dashboard. Your password
          is stored as a secure hash; your first secret key is shown only once.
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
            <label className="mb-2 block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={12}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-shell pr-20"
                placeholder="Create a 12–256 character password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-3 my-auto h-9 px-2 text-xs font-medium text-[var(--muted)] hover:text-white"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  {showPassword ? (
                    <>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.58 10.58a2 2 0 002.83 2.83M9.88 4.24A10.7 10.7 0 0112 4c5.23 0 8.73 4.5 9.7 6a11.6 11.6 0 01-3.1 3.42M6.23 6.23C3.95 7.67 2.62 9.5 2.3 10c.97 1.5 4.47 6 9.7 6 1.13 0 2.17-.2 3.11-.53" />
                    </>
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.3 10C3.27 8.5 6.77 4 12 4s8.73 4.5 9.7 6c-.97 1.5-4.47 6-9.7 6S3.27 11.5 2.3 10zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                  )}
                </svg>
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="confirm-password">
              Confirm password
            </label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                required
                minLength={12}
                maxLength={256}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-shell pr-20"
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                className="absolute inset-y-0 right-3 my-auto h-9 px-2 text-xs font-medium text-[var(--muted)] hover:text-white"
                aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                aria-pressed={showConfirmPassword}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  {showConfirmPassword ? (
                    <>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.58 10.58a2 2 0 002.83 2.83M9.88 4.24A10.7 10.7 0 0112 4c5.23 0 8.73 4.5 9.7 6a11.6 11.6 0 01-3.1 3.42M6.23 6.23C3.95 7.67 2.62 9.5 2.3 10c.97 1.5 4.47 6 9.7 6 1.13 0 2.17-.2 3.11-.53" />
                    </>
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.3 10C3.27 8.5 6.77 4 12 4s8.73 4.5 9.7 6c-.97 1.5-4.47 6-9.7 6S3.27 11.5 2.3 10zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                  )}
                </svg>
              </button>
            </div>
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
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium" htmlFor="stellar">
                Stellar wallet
              </label>
              <button
                type="button"
                onClick={connectWallet}
                disabled={connectingWallet}
                className="button-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {connectingWallet ? "Connecting…" : stellarAddress ? "Reconnect wallet" : "Connect wallet"}
              </button>
            </div>
            <div
              id="stellar"
              className="input-shell min-h-12 break-all font-mono text-sm"
              aria-live="polite"
            >
              {stellarAddress || "No wallet connected"}
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Connect Freighter on Stellar Testnet. Connected address owns your plans and receives revenue.
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
