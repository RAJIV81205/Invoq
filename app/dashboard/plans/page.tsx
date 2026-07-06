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
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="eyebrow">Plans</div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Pricing that ships cleanly.</h1>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Pricing tiers you&apos;ve created. Existing subscribers are unaffected by edits.
            </p>
          </div>
          <NewPlanButton stellarAddress={session.developer.stellarAddress} />
        </div>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="Create your first plan to start accepting subscriptions. Plans are stored on-chain in SubscriptionRegistry."
          action={<NewPlanButton stellarAddress={session.developer.stellarAddress} />}
        />
      ) : (
        <div className="table-shell">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
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
            <tbody className="divide-y divide-white/10">
              {plans.map((p) => (
                <tr key={p.plan_id}>
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
                    <Link href={`/dashboard/plans/${p.plan_id}`} className="text-xs font-medium text-[var(--brand-glow)] hover:text-white">
                      View
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
