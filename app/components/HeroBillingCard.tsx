"use client";

import { useEffect, useRef, useState } from "react";

interface PublicPlatformStats {
  developersOnboarded: number;
  plansCreated: string;
  usdcFlow: string;
  network: string;
  updatedAt: string;
}

function compactUsdc(value: string): string {
  const amount = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return value;

  return new Intl.NumberFormat("en-US", {
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1_000 ? 1 : 2,
  }).format(amount);
}

export default function HeroBillingCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<PublicPlatformStats | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();

    async function loadStats(signal?: AbortSignal) {
      try {
        const response = await fetch("/api/stats", { cache: "no-store", signal });
        if (!response.ok) throw new Error(`Stats request failed with ${response.status}`);
        setStats((await response.json()) as PublicPlatformStats);
        setStatus("live");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      }
    };

    void loadStats(controller.signal);
    const timer = window.setInterval(() => void loadStats(), 30_000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card || event.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--tilt-x", `${-y * 5}deg`);
    card.style.setProperty("--tilt-y", `${x * 5}deg`);
  }

  function resetTilt() {
    cardRef.current?.style.setProperty("--tilt-x", "0deg");
    cardRef.current?.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <div className="hero-reveal relative mx-auto w-full max-w-[680px]" style={{ animationDelay: "280ms" }}>
      <div className="absolute inset-x-16 -bottom-6 h-20 rounded-full bg-[rgba(0,212,255,0.11)] blur-3xl" />
      <div
        ref={cardRef}
        onPointerMove={tilt}
        onPointerLeave={resetTilt}
        className="hero-instrument relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[rgba(19,21,28,0.9)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-5"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-[var(--brand-glow)] opacity-80" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-[var(--muted)]">Total USDC flow</div>
            <div className="mt-1 flex items-baseline gap-2 font-data font-semibold tracking-[-0.04em]">
              <span className="text-2xl sm:text-[1.8rem]">
                {status === "loading" ? "—" : status === "error" || !stats ? "Unavailable" : compactUsdc(stats.usdcFlow)}
              </span>
              {status === "live" && <span className="text-[0.72rem] tracking-[0.04em] text-[var(--brand-glow)]">USDC</span>}
            </div>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-data text-[0.62rem] ${status === "error" ? "border-red-500/20 bg-red-500/5 text-[var(--danger)]" : "border-[rgba(0,229,160,0.18)] bg-[rgba(0,229,160,0.07)] text-[var(--success)]"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" />
            {status === "loading" ? "Syncing" : status === "error" ? "Unavailable" : "On-chain live"}
          </div>
        </div>

        <svg viewBox="0 0 640 104" className="mt-3 h-auto w-full overflow-visible" aria-label="Cumulative on-chain settlement flow" role="img">
          <defs>
            <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#6C5CE7" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hero-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6C5CE7" />
              <stop offset="100%" stopColor="#00D4FF" />
            </linearGradient>
          </defs>
          <path d="M4 87 C70 82 86 67 142 72 S232 51 284 59 S362 30 424 40 S512 18 636 12 L636 104 L4 104 Z" fill="url(#hero-area)" />
          <path className="hero-sparkline" pathLength="1" d="M4 87 C70 82 86 67 142 72 S232 51 284 59 S362 30 424 40 S512 18 636 12" fill="none" stroke="url(#hero-line)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="636" cy="12" r="4" fill="#13151C" stroke="#00D4FF" strokeWidth="2" />
        </svg>

        <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[0.64rem] text-[var(--muted)]">
          <span className="inline-flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${status === "error" ? "bg-[var(--danger)]" : "bg-[var(--success)]"}`} />
            {stats ? `Stellar ${stats.network}` : "Stellar network"}
          </span>
          <span className="font-data text-[var(--foreground)]">
            {stats ? `${stats.developersOnboarded} developers · ${stats.plansCreated} plans` : status === "error" ? "Stats unavailable" : "Loading totals"}
          </span>
          <span className="hidden font-data text-[var(--muted-deep)] sm:inline">
            {stats?.updatedAt ? `Updated ${new Date(stats.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Live API"}
          </span>
        </div>
      </div>
    </div>
  );
}
