"use client";

import { useCallback, useEffect, useState } from "react";

interface PlatformStats {
  developersOnboarded: number;
  plansCreated: string;
  usdcFlow: string;
  network: string;
  updatedAt: string;
}

const EMPTY_STATS: PlatformStats = {
  developersOnboarded: 0,
  plansCreated: "0",
  usdcFlow: "0",
  network: "testnet",
  updatedAt: "",
};

function formatInteger(value: number | string): string {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return "0";
  }
}

export default function LivePlatformStats() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/stats", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`Stats request failed with ${response.status}`);
      const data = (await response.json()) as PlatformStats;
      setStats(data);
      setStatus("live");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void refresh(controller.signal), 0);
    const timer = window.setInterval(() => void refresh(), 30_000);

    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const statusLabel = status === "live"
    ? `Stellar ${stats.network} · live`
    : status === "error"
      ? "Live stats unavailable"
      : "Syncing network";

  return (
    <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
      <div className="p-6 sm:p-8 lg:p-10">
        <div className="eyebrow">Network pulse</div>
        <h2 id="network-stats-heading" className="mt-5 max-w-md text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
          Billing activity, in public view.
        </h2>
        <p className="mt-4 max-w-md text-base leading-7 text-[var(--muted)]">
          Live totals from Mongo and Invoq&apos;s deployed Stellar contracts, refreshed every 30 seconds.
        </p>
        <div
          className="mt-8 flex items-center gap-3 font-data text-[0.65rem] uppercase tracking-[0.14em] text-[var(--muted-deep)]"
          aria-live="polite"
          title={stats.updatedAt ? `Updated ${new Date(stats.updatedAt).toLocaleString()}` : undefined}
        >
          <span className="relative flex h-2 w-2">
            {status === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-50" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status === "error" ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`} />
          </span>
          {statusLabel}
        </div>
      </div>

      <dl className="grid border-t border-[var(--border)] lg:border-l lg:border-t-0 sm:grid-cols-2">
        <div className="stats-cell p-6 sm:p-8">
          <dt className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-[var(--muted)]">Developers onboarded</dt>
          <dd className="mt-5 font-data text-5xl font-medium tracking-[-0.07em] text-[var(--foreground)] sm:text-6xl">
            {formatInteger(stats.developersOnboarded)}
          </dd>
          <dd className="mt-3 text-sm text-[var(--muted-deep)]">Mongo developer records</dd>
        </div>
        <div className="stats-cell p-6 sm:p-8">
          <dt className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-[var(--muted)]">Plans created</dt>
          <dd className="mt-5 font-data text-5xl font-medium tracking-[-0.07em] text-[var(--foreground)] sm:text-6xl">
            {formatInteger(stats.plansCreated)}
          </dd>
          <dd className="mt-3 text-sm text-[var(--muted-deep)]">Registry contract plan count</dd>
        </div>
        <div className="stats-flow-cell p-6 sm:col-span-2 sm:p-8">
          <dt className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-[var(--muted)]">Total USDC flow</dt>
          <dd>
            <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="font-data text-5xl font-medium tracking-[-0.07em] text-[var(--foreground)] sm:text-6xl">
                {stats.usdcFlow} <span className="text-xl tracking-[-0.03em] text-[var(--brand-glow)] sm:text-2xl">USDC</span>
              </div>
              <div className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-[var(--muted-deep)]">Settled to developers</div>
            </div>

            <div className="mt-8" aria-hidden="true">
              <div className="stats-rail">
                <span className="stats-rail-pulse" />
                <span className="stats-rail-pulse stats-rail-pulse-b" />
              </div>
           
            </div>
          </dd>
        </div>
      </dl>
    </div>
  );
}
