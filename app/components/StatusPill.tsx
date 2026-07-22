const COLORS: Record<string, string> = {
  Active:        "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  Trialing:      "bg-cyan-400/12 text-cyan-300 ring-cyan-400/25",
  GracePeriod:   "bg-amber-400/12 text-amber-300 ring-amber-400/25",
  Paused:        "bg-slate-400/12 text-slate-300 ring-slate-400/25",
  Cancelled:     "bg-rose-400/12 text-rose-300 ring-rose-400/25",
  Expired:       "bg-rose-400/12 text-rose-300 ring-rose-400/25",
  delivered:     "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  pending:       "bg-slate-400/12 text-slate-300 ring-slate-400/25",
  retrying:      "bg-amber-400/12 text-amber-300 ring-amber-400/25",
  failed:        "bg-rose-400/12 text-rose-300 ring-rose-400/25",
  allowed:       "bg-emerald-400/12 text-emerald-300 ring-emerald-400/25",
  blocked:       "bg-rose-400/12 text-rose-300 ring-rose-400/25",
};

export default function StatusPill({ status }: { status: string }) {
  const cls = COLORS[status] ?? "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-medium tracking-[0.02em] ring-1 ring-inset ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  );
}
