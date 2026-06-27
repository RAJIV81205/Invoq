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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--muted)] font-medium mb-2">
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && (
          <span className={positive ? "text-emerald-400" : "text-rose-400"}>
            {positive ? "▲" : "▼"} {delta}
          </span>
        )}
        {hint && <span className="text-[var(--muted)]">{hint}</span>}
      </div>
    </div>
  );
}
