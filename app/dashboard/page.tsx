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
  const deliveredCount = deliveries.filter((d) => d.status === "delivered").length;
  const failedCount = deliveries.filter((d) => d.status === "failed").length;
  const deliveryRate = deliveries.length ? Math.round((deliveredCount / deliveries.length) * 100) : 100;

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

  const renewalTotal = days.reduce((sum, day) => sum + day.value, 0);

  return (
    <div className="space-y-5">
      <section className="card-enter flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-glow)] shadow-[0_0_10px_var(--brand-glow)]" />
            Live billing overview
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-[2.5rem]">Money in motion.</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">Revenue, renewals, and settlement health across your Stellar billing stack.</p>
        </div>
        <div className="font-data text-[0.68rem] text-[var(--muted-deep)]">Updated from live API</div>
      </section>

      <section className="card-enter surface grid gap-y-5 rounded-2xl py-5 sm:grid-cols-2 lg:grid-cols-4" style={{ animationDelay: "40ms" }}>
        <KpiCard label="MRR"           value={fmtUsdc(mrrUsdc)}  hint="monthly recurring" />
        <KpiCard label="ARR"           value={fmtUsdc(mrrUsdc * 12)} hint="annualised" />
        <KpiCard label="Active subs"   value={String(activeCount)} hint={`${cancelledCount} cancelled`} />
        <KpiCard label="Plans"         value={String(plans.length)} hint={`${plans.filter((p) => p.active).length} active`} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <div className="card-enter surface relative overflow-hidden rounded-2xl p-5 sm:p-6" style={{ animationDelay: "80ms" }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-[var(--brand-glow)] opacity-70" />
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Settlement rail · 7 days</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-data text-3xl font-semibold">{renewalTotal}</span>
                <span className="text-xs text-[var(--muted)]">confirmed renewals</span>
              </div>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(0,229,160,0.18)] bg-[rgba(0,229,160,0.07)] px-3 py-1.5 text-[0.68rem] text-[var(--success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-current glow" /> On-chain live
            </span>
          </div>
          <UsageChart data={days} height={220} />
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-4 text-[0.68rem] text-[var(--muted)]">
            <span>payment.renewed events</span>
            <span className="font-data text-[var(--foreground)]">5s network finality</span>
          </div>
        </div>

        <aside className="card-enter surface rounded-2xl p-5" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Delivery health</div>
              <div className="mt-2 font-data text-3xl font-semibold">{deliveryRate}%</div>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-full border border-[rgba(0,229,160,0.2)] bg-[rgba(0,229,160,0.06)] text-[var(--success)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5"><path d="m7 12 3 3 7-7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
          <div className="mt-5 h-1 overflow-hidden rounded-full bg-[var(--surface-elevated)]"><div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${deliveryRate}%` }} /></div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-b border-[var(--border)] pb-5 text-xs">
            <div><span className="font-data text-[var(--foreground)]">{deliveredCount}</span><span className="ml-1.5 text-[var(--muted)]">delivered</span></div>
            <div><span className="font-data text-[var(--danger)]">{failedCount}</span><span className="ml-1.5 text-[var(--muted)]">failed</span></div>
          </div>
          <h2 className="mb-2 mt-5 text-sm font-medium">Continue setup</h2>
          <div className="divide-y divide-[var(--border)]">
            {[
              ["Create pricing plan", "/dashboard/plans"],
              ["Connect notifications", "/dashboard/webhooks"],
              ["Issue API key", "/dashboard/keys"],
            ].map(([label, href], index) => (
              <Link key={href} href={href} className="group flex items-center justify-between py-3 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]">
                <span><span className="mr-2 font-data text-[var(--muted-deep)]">0{index + 1}</span>{label}</span>
                <span className="transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-glow)]">→</span>
              </Link>
            ))}
          </div>
        </aside>
      </section>

      <section className="card-enter table-shell" style={{ animationDelay: "160ms" }}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div><h2 className="text-sm font-medium">Live event stream</h2><p className="mt-0.5 text-[0.68rem] text-[var(--muted)]">Newest billing activity across your workspace</p></div>
          <Link href="/dashboard/webhooks" className="text-xs font-medium text-[var(--brand-glow)] hover:text-white">
            View log →
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
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-white/[0.02]">
                <StatusPill status={d.status} />
                <span className="font-data flex-1 truncate text-xs text-[var(--foreground)]">{d.event}</span>
                <span className="font-data text-[0.68rem] text-[var(--muted)]">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
