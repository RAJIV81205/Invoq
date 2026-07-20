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

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
          <label className="mb-2 block text-sm font-medium" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-shell"
            placeholder="At least 12 characters"
          />
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
