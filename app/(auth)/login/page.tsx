"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Network error";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/developers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Login failed");
        return;
      }
      router.push(from);
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-strong w-full max-w-md rounded-[2rem] p-7 sm:p-8">
      <div className="eyebrow">Sign in</div>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">Welcome back.</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Use your developer account email and password to sign in.
      </p>

      <form onSubmit={onSubmit} autoComplete="off" className="mt-6 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            autoComplete="off"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-shell"
            placeholder="you@example.com"
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
              placeholder="Enter your 12–256 character password"
              autoComplete="off"
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
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--muted)]">
        No account?{" "}
        <Link href="/signup" className="font-medium text-[var(--foreground)] hover:text-white">
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="surface-strong h-[28rem] w-full max-w-md rounded-[2rem]" />}>
      <LoginForm />
    </Suspense>
  );
}
