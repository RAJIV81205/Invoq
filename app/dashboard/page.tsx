import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import KpiCard from "@/app/components/KpiCard";
import UsageChart from "@/app/components/UsageChart";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";
import Link from "next/link";

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
  const deliveries = deliveriesRes.ok ? await deliveriesRes.json() : [];

  const subs = subsData.subscriptions ?? [];
  const plans = plansData.plans ?? [];

  // Compute MRR + ARR using cached planId -> plan map. For now we use the
  // active subscription count and an aggregated estimate.
  const planMap = new Map<number, any>();
  for (const p of plans) planMap.set(Number(p.plan_id), p);

  let mrrUsdc = 0;
  for (const s of subs) {
    if (s.status !== "Active" && s.status !== "Trialing" && s.status !== "GracePeriod") continue;
    const plan = planMap.get(s.planId);
    if (!plan) continue;
    // Monthly normalised: interval_seconds / (30d) * price
    const intervalDays = Number(plan.interval_seconds) / 86_400;
    const monthly = usdc(plan.price_usdc) * (30 / Math.max(1, intervalDays));
    mrrUsdc += monthly;
  }

  const activeCount = subs.filter(
    (s: any) => s.status === "Active" || s.status === "Trialing" || s.status === "GracePeriod"
  ).length;
  const cancelledCount = subs.filter((s: any) => s.status === "Cancelled").length;

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Your subscription business at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="MRR"           value={fmtUsdc(mrrUsdc)}  hint="monthly recurring" />
        <KpiCard label="ARR"           value={fmtUsdc(mrrUsdc * 12)} hint="annualised" />
        <KpiCard label="Active subs"   value={String(activeCount)} hint={`${cancelledCount} cancelled`} />
        <KpiCard label="Plans"         value={String(plans.length)} hint={`${plans.filter((p: any) => p.active).length} active`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Renewals · last 7 days</h2>
            <span className="text-xs text-[var(--muted)]">payment.renewed events</span>
          </div>
          <UsageChart data={days} height={160} />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="font-semibold mb-3">Quick actions</h2>
          <div className="space-y-2">
            <Link
              href="/dashboard/plans"
              className="block rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)] transition"
            >
              <span className="font-medium">Create a plan</span>
              <p className="text-xs text-[var(--muted)] mt-0.5">Define pricing, intervals, features.</p>
            </Link>
            <Link
              href="/dashboard/webhooks"
              className="block rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)] transition"
            >
              <span className="font-medium">Register webhook</span>
              <p className="text-xs text-[var(--muted)] mt-0.5">Receive billing events in your backend.</p>
            </Link>
            <Link
              href="/dashboard/keys"
              className="block rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)] transition"
            >
              <span className="font-medium">Mint publishable key</span>
              <p className="text-xs text-[var(--muted)] mt-0.5">Use pk_ keys safely in the browser.</p>
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <h2 className="font-semibold">Recent activity</h2>
          <Link href="/dashboard/webhooks" className="text-xs text-[var(--brand)] hover:underline">
            See all →
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
          <div className="divide-y divide-[var(--border)]">
            {deliveries.map((d: any) => (
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
