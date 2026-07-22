"use client";

import { useEffect, useState } from "react";

export default function KpiCard({
  label,
  value,
  delta,
  hint,
  positive,
}: {
  label: string;
  value: string;
  delta?: string;
  hint?: string;
  positive?: boolean;
}) {
  const match = value.match(/^([^\d-]*)(-?[\d,.]+)(.*)$/);
  const target = match ? Number(match[2].replace(/,/g, "")) : Number.NaN;
  const decimals = match?.[2].split(".")[1]?.length ?? 0;
  const [shown, setShown] = useState(Number.isFinite(target) ? 0 : target);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 520);
      setShown(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const display = match && Number.isFinite(shown)
    ? `${match[1]}${shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${match[3]}`
    : value;

  return (
    <div className="group border-l border-[var(--border)] px-5 first:border-l-0 sm:first:border-l sm:first:border-l-[var(--border)]">
      <div className="mb-2 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
      </div>
      <div className="font-data text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)] lg:text-[1.7rem]">{display}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && (
          <span className={positive ? "text-[var(--success)]" : "text-[var(--danger)]"}>
            {positive ? "↗" : "↘"} {delta}
          </span>
        )}
        {hint && <span className="text-[var(--muted)]">{hint}</span>}
      </div>
    </div>
  );
}
