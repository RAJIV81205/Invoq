import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import Link from "next/link";
import { notFound } from "next/navigation";
import CustomerActions from "./CustomerActions";
import type { OnChainSubscription, WebhookDelivery } from "@/app/lib/types";

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerAddress: string }> }) {
  const { customerAddress } = await params;
  const session = await requireSession();

  const [subRes, histRes] = await Promise.all([
    apiFetch(session, `/v1/subscriptions/${customerAddress}`),
    apiFetch(session, `/v1/subscriptions/${customerAddress}/history`),
  ]);

  if (subRes.status === 404) notFound();
  const sub: OnChainSubscription | null = subRes.ok ? await subRes.json() : null;
  const hist: { events: WebhookDelivery[]; transactions: unknown[] } =
    histRes.ok ? await histRes.json() : { events: [], transactions: [] };

  return (
    <div className="space-y-6">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <Link href="/dashboard/customers" className="text-sm font-medium text-[var(--brand-glow)] hover:text-white">← All customers</Link>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] font-mono break-all sm:text-3xl">{customerAddress}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Customer detail</p>
          </div>
          {sub && <CustomerActions customerAddress={customerAddress} status={sub.status} />}
        </div>
      </div>

      {sub ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="surface rounded-[1.5rem] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Status</div>
            <div className="mt-1"><StatusPill status={sub.status} /></div>
          </div>
          <div className="surface rounded-[1.5rem] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Plan</div>
            <div className="text-2xl font-semibold tracking-[-0.04em]">#{sub.plan_id}</div>
          </div>
          <div className="surface rounded-[1.5rem] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Period ends</div>
            <div className="text-lg font-medium tracking-[-0.03em]">
              {new Date(Number(sub.current_period_end) * 1000).toLocaleString()}
            </div>
          </div>
          <div className="surface rounded-[1.5rem] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Usage this period</div>
            <div className="text-2xl font-semibold tracking-[-0.04em]">{Number(sub.usage_current).toLocaleString()}</div>
          </div>
        </div>
      ) : (
        <div className="surface rounded-[1.5rem] p-5 text-sm text-[var(--muted)]">
          No subscription on-chain for this address.
        </div>
      )}

      <div className="table-shell">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold tracking-[-0.03em]">Webhook events</h2>
        </div>
        {hist.events?.length > 0 ? (
          <div className="divide-y divide-white/10">
            {hist.events.map((e) => (
              <div key={e.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <StatusPill status={e.status} />
                <span className="font-mono text-xs text-[var(--muted)] flex-1 truncate">{e.event}</span>
                <span className="text-xs text-[var(--muted)]">
                  {e.deliveredAt ? new Date(e.deliveredAt).toLocaleString() : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5 text-sm text-[var(--muted)]">No webhook events yet.</div>
        )}
      </div>
    </div>
  );
}
