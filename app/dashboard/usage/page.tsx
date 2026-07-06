import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import EmptyState from "@/app/components/EmptyState";

export default async function UsagePage() {
  const session = await requireSession();
  const [subsRes, plansRes] = await Promise.all([
    apiFetch(session, "/v1/subscriptions"),
    apiFetch(session, "/v1/plans"),
  ]);
  const subs: any[] = subsRes.ok ? (await subsRes.json()).subscriptions ?? [] : [];
  const plansData = plansRes.ok ? await plansRes.json() : { plans: [] };
  const plans: any[] = plansData.plans ?? [];

  // Aggregate by plan
  const byPlan = new Map<number, { name: string; usage: number; subs: number }>();
  for (const s of subs) {
    const key = Number(s.planId);
    const plan = plans.find((p) => Number(p.plan_id) === key);
    const e = byPlan.get(key) ?? { name: plan?.name ?? `Plan #${key}`, usage: 0, subs: 0 };
    e.usage += Number(s.usageCurrent);
    e.subs  += 1;
    byPlan.set(key, e);
  }

  const leaderboard = [...subs]
    .sort((a, b) => Number(b.usageCurrent) - Number(a.usageCurrent))
    .slice(0, 25);

  function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-6)}`; }

  return (
    <div className="space-y-8">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="eyebrow">Usage</div>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Consumption across plans.</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          Aggregated consumption across your plans.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.03em]">By plan</h2>
        {byPlan.size === 0 ? (
          <EmptyState
            title="No usage yet"
            description="Once customers hit your API and the usage buffer flushes to chain, totals will appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from(byPlan.entries()).map(([planId, agg]) => (
              <div key={planId} className="surface rounded-[1.5rem] p-5">
                <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Plan #{planId}</div>
                <div className="text-lg font-semibold tracking-[-0.03em]">{agg.name}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-[var(--muted)]">Total usage</div>
                    <div className="font-medium">{agg.usage.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--muted)]">Subscribers</div>
                    <div className="font-medium">{agg.subs}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.03em]">Top consumers (current period)</h2>
        {leaderboard.length === 0 ? (
          <div className="surface-soft rounded-[1.5rem] p-6 text-center text-sm text-[var(--muted)]">
            No data
          </div>
        ) : (
          <div className="table-shell">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
                <tr>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {leaderboard.map((s) => (
                  <tr key={s.customerAddress}>
                    <td className="px-5 py-3 font-mono text-xs">{short(s.customerAddress)}</td>
                    <td className="px-5 py-3">#{s.planId}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{s.status}</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {Number(s.usageCurrent).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
