const COLORS: Record<string, string> = {
  Active:        "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  Trialing:      "bg-sky-500/15    text-sky-300    ring-sky-500/30",
  GracePeriod:   "bg-amber-500/15  text-amber-300  ring-amber-500/30",
  Paused:        "bg-zinc-500/15   text-zinc-300   ring-zinc-500/30",
  Cancelled:     "bg-rose-500/15   text-rose-300   ring-rose-500/30",
  Expired:       "bg-rose-500/15   text-rose-300   ring-rose-500/30",
  delivered:     "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  pending:       "bg-zinc-500/15   text-zinc-300   ring-zinc-500/30",
  retrying:      "bg-amber-500/15  text-amber-300  ring-amber-500/30",
  failed:        "bg-rose-500/15   text-rose-300   ring-rose-500/30",
  allowed:       "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  blocked:       "bg-rose-500/15   text-rose-300   ring-rose-500/30",
};

export default function StatusPill({ status }: { status: string }) {
  const cls = COLORS[status] ?? "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}
