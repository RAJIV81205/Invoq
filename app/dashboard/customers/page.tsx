import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";
import Link from "next/link";

function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-6)}`; }

export default async function CustomersPage() {
  const session = await requireSession();
  const res = await apiFetch(session, "/v1/subscriptions");
  const data = res.ok ? await res.json() : { subscriptions: [] };
  const subs: any[] = data.subscriptions ?? [];

  return (
    <div className="space-y-6">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="eyebrow">Customers</div>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Subscribers in one place.</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          {subs.length} subscriber{subs.length === 1 ? "" : "s"} on your plans.
        </p>
      </div>

      {subs.length === 0 ? (
        <EmptyState
          title="No subscribers yet"
          description="Once a customer signs up for one of your plans, they'll appear here with their current period, usage, and status."
        />
      ) : (
        <div className="table-shell">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Period ends</th>
                <th className="px-5 py-3 font-medium">Usage</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {subs.map((s) => (
                <tr key={s.customerAddress}>
                  <td className="px-5 py-3 font-mono text-xs">
                    <Link href={`/dashboard/customers/${s.customerAddress}`} className="hover:text-[var(--brand)]">
                      {short(s.customerAddress)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">#{s.planId}</td>
                  <td className="px-5 py-3"><StatusPill status={s.status} /></td>
                  <td className="px-5 py-3 text-[var(--muted)]">
                    {new Date(s.currentPeriodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-[var(--muted)]">
                    {s.usageCurrent.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/customers/${s.customerAddress}`}
                      className="text-xs font-medium text-[var(--brand-glow)] hover:text-white"
                    >
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
