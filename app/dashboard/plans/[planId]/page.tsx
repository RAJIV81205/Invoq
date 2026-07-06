import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import Link from "next/link";
import { notFound } from "next/navigation";
import DeactivateButton from "./DeactivateButton";

const STROOPS_PER_USDC = 10_000_000;

function fmtUsdc(n: string | number) { return `$${(Number(n) / STROOPS_PER_USDC).toFixed(2)}`; }
function fmtInterval(s: string | number) {
  const n = Number(s);
  if (n % (30 * 86_400) === 0)  return `${n / (30 * 86_400)} months`;
  if (n % (7 * 86_400) === 0)   return `${n / (7 * 86_400)} weeks`;
  if (n % 86_400 === 0)         return `${n / 86_400} days`;
  return `${n} seconds`;
}

export default async function PlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const session = await requireSession();
  const res = await apiFetch(session, `/v1/plans/${planId}`);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return <div className="rounded-[1.5rem] border border-[var(--danger)]/20 bg-[var(--danger)]/10 p-5 text-sm text-rose-200">Failed to load plan: {res.status}</div>;
  }
  const plan = await res.json();

  return (
    <div className="space-y-6">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <Link href="/dashboard/plans" className="text-sm font-medium text-[var(--brand-glow)] hover:text-white">← All plans</Link>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.05em]">{plan.name}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Plan ID <span className="font-mono">{plan.plan_id}</span> · Owner <span className="font-mono">{plan.owner}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={plan.active ? "Active" : "Cancelled"} />
            <DeactivateButton planId={plan.plan_id} active={plan.active} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface rounded-[1.5rem] p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Price</div>
          <div className="text-2xl font-semibold tracking-[-0.04em]">{fmtUsdc(plan.price_usdc)}</div>
          <div className="text-xs text-[var(--muted)] mt-1">per {fmtInterval(plan.interval_seconds)}</div>
        </div>
        <div className="surface rounded-[1.5rem] p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Trial</div>
          <div className="text-2xl font-semibold tracking-[-0.04em]">{Number(plan.trial_seconds) > 0 ? fmtInterval(plan.trial_seconds) : "—"}</div>
        </div>
        <div className="surface rounded-[1.5rem] p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Usage limit</div>
          <div className="text-2xl font-semibold tracking-[-0.04em]">{Number(plan.usage_limit) === 0 ? "∞" : plan.usage_limit}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{Number(plan.usage_limit) === 0 ? "unlimited" : "units per period"}</div>
        </div>
        <div className="surface rounded-[1.5rem] p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1">Created</div>
          <div className="text-lg font-medium tracking-[-0.03em]">{new Date(Number(plan.created_at) * 1000).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="surface rounded-[1.5rem] p-5">
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.03em]">Features</h2>
        {plan.features?.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {plan.features.map((f: string) => (
              <span key={f} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono">
                {f}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No features configured.</p>
        )}
      </div>
    </div>
  );
}
