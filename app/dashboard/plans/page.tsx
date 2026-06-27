import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import EmptyState from "@/app/components/EmptyState";
import StatusPill from "@/app/components/StatusPill";
import Link from "next/link";
import NewPlanButton from "./NewPlanButton";

const STROOPS_PER_USDC = 10_000_000;

function fmtUsdc(stroops: string | number): string {
  return `$${(Number(stroops) / STROOPS_PER_USDC).toFixed(2)}`;
}

function fmtInterval(secs: string | number): string {
  const s = Number(secs);
  if (s % (30 * 86_400) === 0)  return `${s / (30 * 86_400)}mo`;
  if (s % (7 * 86_400) === 0)   return `${s / (7 * 86_400)}w`;
  if (s % 86_400 === 0)         return `${s / 86_400}d`;
  return `${s}s`;
}

export default async function PlansPage() {
  const session = await requireSession();
  const res = await apiFetch(session, "/v1/plans");
  const data = res.ok ? await res.json() : { plans: [] };
  const plans: any[] = data.plans ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Pricing tiers you&apos;ve created. Existing subscribers are unaffected by edits.
          </p>
        </div>
        <NewPlanButton stellarAddress={session.developer.stellarAddress} />
      </div>

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="Create your first plan to start accepting subscriptions. Plans are stored on-chain in SubscriptionRegistry."
          action={<NewPlanButton stellarAddress={session.developer.stellarAddress} />}
        />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Interval</th>
                <th className="px-5 py-3 font-medium">Trial</th>
                <th className="px-5 py-3 font-medium">Subscribers</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {plans.map((p) => (
                <tr key={p.plan_id} className="hover:bg-[var(--background)]/50">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/dashboard/plans/${p.plan_id}`} className="hover:text-[var(--brand)]">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{fmtUsdc(p.price_usdc)}</td>
                  <td className="px-5 py-3">{fmtInterval(p.interval_seconds)}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">
                    {Number(p.trial_seconds) > 0 ? fmtInterval(p.trial_seconds) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {p.active_subscribers ?? 0}
                    <span className="text-xs text-[var(--muted)]"> / {p.total_subscribers ?? 0}</span>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill status={p.active ? "Active" : "Cancelled"} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/dashboard/plans/${p.plan_id}`} className="text-xs text-[var(--brand)] hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
