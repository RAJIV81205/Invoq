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
  return (
    <div className="surface rounded-[1.5rem] p-5 transition hover:-translate-y-0.5 hover:border-white/20">
      <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--muted)] font-semibold mb-2">
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-[-0.04em]">{value}</div>
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
