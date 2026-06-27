import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import NewKeyButton from "./NewKeyButton";
import RevokeButton from "./RevokeButton";

export default async function KeysPage() {
  const session = await requireSession();
  const res = await apiFetch(session, "/v1/keys");
  const keys: any[] = res.ok ? await res.json() : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Secret (sk_) keys for your server. Publishable (pk_) keys for the browser.
          </p>
        </div>
        <NewKeyButton />
      </div>

      {keys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
          No keys yet.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Env</th>
                <th className="px-5 py-3 font-medium">Prefix</th>
                <th className="px-5 py-3 font-medium">Last used</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="px-5 py-3 font-medium">{k.name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs">{k.type}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">{k.env}</td>
                  <td className="px-5 py-3 font-mono text-xs text-[var(--muted)]">{k.keyPrefix}…</td>
                  <td className="px-5 py-3 text-[var(--muted)] text-xs">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill status={k.revoked ? "Cancelled" : "Active"} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!k.revoked && <RevokeButton keyId={k.id} />}
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
