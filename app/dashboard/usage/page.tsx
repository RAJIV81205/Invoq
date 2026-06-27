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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Aggregated consumption across your plans.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-3">By plan</h2>
        {byPlan.size === 0 ? (
          <EmptyState
            title="No usage yet"
            description="Once customers hit your API and the usage buffer flushes to chain, totals will appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from(byPlan.entries()).map(([planId, agg]) => (
              <div key={planId} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="text-xs uppercase text-[var(--muted)] mb-1">Plan #{planId}</div>
                <div className="text-lg font-semibold">{agg.name}</div>
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
        <h2 className="font-semibold mb-3">Top consumers (current period)</h2>
        {leaderboard.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            No data
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Usage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
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
