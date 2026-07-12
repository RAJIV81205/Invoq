import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import EmptyState from "@/app/components/EmptyState";
import type { VaultBalance } from "@/app/lib/types";

const STROOPS_PER_USDC = 10_000_000;
function fmtUsdc(s: string | number | bigint) { return `$${(Number(s) / STROOPS_PER_USDC).toFixed(2)}`; }
function short(a: string) { return `${a.slice(0, 6)}…${a.slice(-6)}`; }

export default async function VaultPage() {
  const session = await requireSession();
  const res = await apiFetch(session, "/v1/vault/balances");
  const data = res.ok ? await res.json() : { vaults: [] };
  const vaults: VaultBalance[] = data.vaults ?? [];

  return (
    <div className="space-y-6">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="eyebrow">Vault</div>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Prepaid balances, tracked.</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          Prepaid USDC balances held in EscrowVault for usage-based billing.
        </p>
      </div>

      {vaults.length === 0 ? (
        <EmptyState
          title="No active vaults"
          description="When a customer opens a vault and deposits USDC, it will appear here. Customers can close their vault at any time to refund the balance."
        />
      ) : (
        <div className="table-shell">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Balance</th>
                <th className="px-5 py-3 font-medium">Total deposited</th>
                <th className="px-5 py-3 font-medium">Total debited</th>
                <th className="px-5 py-3 font-medium">Threshold</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {vaults.map((v) => (
                <tr key={v.customer}>
                  <td className="px-5 py-3 font-mono text-xs">{short(v.customer)}</td>
                  <td className="px-5 py-3 font-medium">{fmtUsdc(v.balance_usdc)}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">{fmtUsdc(v.total_deposited)}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">{fmtUsdc(v.total_debited)}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">
                    {Number(v.low_balance_threshold) > 0 ? fmtUsdc(v.low_balance_threshold) : "—"}
                  </td>
                  <td className="px-5 py-3 text-[var(--muted)] text-xs">
                    {new Date(Number(v.created_at) * 1000).toLocaleDateString()}
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
