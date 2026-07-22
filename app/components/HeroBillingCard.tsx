"use client";

import { useEffect, useRef, useState } from "react";

export default function HeroBillingCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mrr, setMrr] = useState(128.1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const reducedFrame = requestAnimationFrame(() => setMrr(128.4));
      return () => cancelAnimationFrame(reducedFrame);
    }

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 620);
      const eased = 1 - Math.pow(1 - progress, 4);
      setMrr(128.1 + 0.3 * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
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
            <div className="font-data text-[0.62rem] uppercase tracking-[0.16em] text-[var(--muted)]">Recurring revenue</div>
            <div className="mt-1 font-data text-2xl font-semibold tracking-[-0.04em] sm:text-[1.8rem]">
              ${mrr.toFixed(1)}k
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(0,229,160,0.18)] bg-[rgba(0,229,160,0.07)] px-2.5 py-1 font-data text-[0.62rem] text-[var(--success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_9px_currentColor]" /> Live
          </div>
        </div>

        <svg viewBox="0 0 640 104" className="mt-3 h-auto w-full overflow-visible" aria-label="Recurring revenue trend rising over seven days" role="img">
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
          <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> Payment renewed</span>
          <span className="font-data text-[var(--foreground)]">+ 48.00 USDC</span>
          <span className="hidden font-data text-[var(--muted-deep)] sm:inline">2s ago</span>
        </div>
      </div>
    </div>
  );
}
