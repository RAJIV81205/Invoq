import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import KpiCard from "@/app/components/KpiCard";
import UsageChart from "@/app/components/UsageChart";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";
import Link from "next/link";
import type { DashboardPlan, DashboardSubscription, WebhookDelivery } from "@/app/lib/types";

const STROOPS_PER_USDC = 10_000_000;

function usdc(stroops: string | number | bigint): number {
  return Number(stroops) / STROOPS_PER_USDC;
}

function fmtUsdc(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}k`;
  return `$${n.toFixed(2)}`;
}

export default async function DashboardOverviewPage() {
  const session = await requireSession();

  const [plansRes, subsRes, deliveriesRes] = await Promise.all([
    apiFetch(session, "/v1/plans"),
    apiFetch(session, "/v1/subscriptions"),
    apiFetch(session, "/v1/webhooks/log?limit=10"),
  ]);

  const plansData = plansRes.ok ? await plansRes.json() : { plans: [] };
  const subsData  = subsRes.ok  ? await subsRes.json()  : { subscriptions: [] };
  const deliveries: WebhookDelivery[] = deliveriesRes.ok ? await deliveriesRes.json() : [];

  const subs: DashboardSubscription[] = subsData.subscriptions ?? [];
  const plans: DashboardPlan[] = plansData.plans ?? [];

  // Compute MRR + ARR using cached planId -> plan map. For now we use the
  // active subscription count and an aggregated estimate.
  const planMap = new Map<number, DashboardPlan>();
  for (const p of plans) planMap.set(Number(p.plan_id), p);

  let mrrUsdc = 0;
  for (const s of subs) {
    if (s.status !== "Active" && s.status !== "Trialing" && s.status !== "GracePeriod") continue;
    const plan = planMap.get(Number(s.planId));
    if (!plan) continue;
    // Monthly normalised: interval_seconds / (30d) * price
    const intervalDays = Number(plan.interval_seconds) / 86_400;
    const monthly = usdc(plan.price_usdc) * (30 / Math.max(1, intervalDays));
    mrrUsdc += monthly;
  }

  const activeCount = subs.filter(
    (s) => s.status === "Active" || s.status === "Trialing" || s.status === "GracePeriod"
  ).length;
  const cancelledCount = subs.filter((s) => s.status === "Cancelled").length;

  // Build a tiny 7-day sparkline of payment.renewed events from the delivery log.
  const days: { label: string; value: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth() + 1}/${d.getDate()}`;
    days.push({ label: key, value: 0 });
  }
  for (const d of deliveries) {
    if (d.event !== "payment.renewed") continue;
    const at = new Date(d.createdAt ?? d.deliveredAt ?? 0);
    const diff = Math.floor((now.getTime() - at.getTime()) / (1000 * 60 * 60 * 24));
    if (diff >= 0 && diff < 7) {
      const idx = 6 - diff;
      if (days[idx]) days[idx].value += 1;
    }
  }

  return (
    <div className="space-y-8">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="eyebrow">Overview</div>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              Your revenue engine, at a glance.
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--muted)]">
              MRR, subscriptions, usage, and recent delivery activity in one calm control room.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Live API</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Redis cache</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Webhook delivery</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="MRR"           value={fmtUsdc(mrrUsdc)}  hint="monthly recurring" />
        <KpiCard label="ARR"           value={fmtUsdc(mrrUsdc * 12)} hint="annualised" />
        <KpiCard label="Active subs"   value={String(activeCount)} hint={`${cancelledCount} cancelled`} />
        <KpiCard label="Plans"         value={String(plans.length)} hint={`${plans.filter((p) => p.active).length} active`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 surface rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold tracking-[-0.03em]">Renewals · last 7 days</h2>
            <span className="text-xs text-[var(--muted)]">payment.renewed events</span>
          </div>
          <UsageChart data={days} height={160} />
        </div>

        <div className="surface rounded-[1.75rem] p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-[-0.03em] mb-4">Quick actions</h2>
          <div className="space-y-2">
            <Link
              href="/dashboard/plans"
              className="block rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm transition hover:bg-white/7"
            >
              <span className="font-medium">Create a plan</span>
              <p className="mt-1 text-xs text-[var(--muted)]">Define pricing, intervals, features.</p>
            </Link>
            <Link
              href="/dashboard/webhooks"
              className="block rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm transition hover:bg-white/7"
            >
              <span className="font-medium">Register webhook</span>
              <p className="mt-1 text-xs text-[var(--muted)]">Receive billing events in your backend.</p>
            </Link>
            <Link
              href="/dashboard/keys"
              className="block rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm transition hover:bg-white/7"
            >
              <span className="font-medium">Mint publishable key</span>
              <p className="mt-1 text-xs text-[var(--muted)]">Use pk_ keys safely in the browser.</p>
            </Link>
          </div>
        </div>
      </div>

      <div className="table-shell">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold tracking-[-0.03em]">Recent activity</h2>
          <Link href="/dashboard/webhooks" className="text-xs font-medium text-[var(--brand-glow)] hover:text-white">
            See all
          </Link>
        </div>
        {deliveries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No webhook deliveries yet"
              description="Once you register a webhook endpoint and billing events fire, they'll show up here in real time."
            />
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {deliveries.map((d) => (
              <div key={d.id} className="px-5 py-3 flex items-center gap-3">
                <StatusPill status={d.status} />
                <span className="font-mono text-xs text-[var(--muted)] flex-1 truncate">{d.event}</span>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
