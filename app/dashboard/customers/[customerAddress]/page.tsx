import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import Link from "next/link";
import { notFound } from "next/navigation";
import CustomerActions from "./CustomerActions";

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerAddress: string }> }) {
  const { customerAddress } = await params;
  const session = await requireSession();

  const [subRes, histRes] = await Promise.all([
    apiFetch(session, `/v1/subscriptions/${customerAddress}`),
    apiFetch(session, `/v1/subscriptions/${customerAddress}/history`),
  ]);

  if (subRes.status === 404) notFound();
  const sub = subRes.ok ? await subRes.json() : null;
  const hist = histRes.ok ? await histRes.json() : { events: [], transactions: [] };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/customers" className="text-sm text-[var(--brand)] hover:underline">← All customers</Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight font-mono break-all">{customerAddress}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Customer detail</p>
          </div>
          {sub && <CustomerActions customerAddress={customerAddress} status={sub.status} />}
        </div>
      </div>

      {sub ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="text-xs uppercase text-[var(--muted)] mb-1">Status</div>
            <div className="mt-1"><StatusPill status={sub.status} /></div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="text-xs uppercase text-[var(--muted)] mb-1">Plan</div>
            <div className="text-2xl font-semibold">#{sub.plan_id}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="text-xs uppercase text-[var(--muted)] mb-1">Period ends</div>
            <div className="text-lg font-medium">
              {new Date(Number(sub.current_period_end) * 1000).toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="text-xs uppercase text-[var(--muted)] mb-1">Usage this period</div>
            <div className="text-2xl font-semibold">{Number(sub.usage_current).toLocaleString()}</div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted)]">
          No subscription on-chain for this address.
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <h2 className="font-semibold">Webhook events</h2>
        </div>
        {hist.events?.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {hist.events.map((e: any) => (
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
