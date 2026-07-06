import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import StatusPill from "@/app/components/StatusPill";
import EmptyState from "@/app/components/EmptyState";
import NewEndpointButton from "./NewEndpointButton";

export default async function WebhooksPage() {
  const session = await requireSession();
  const [endpointsRes, logRes] = await Promise.all([
    apiFetch(session, "/v1/webhooks"),
    apiFetch(session, "/v1/webhooks/log?limit=200"),
  ]);
  const endpoints: any[] = endpointsRes.ok ? await endpointsRes.json() : [];
  const log: any[] = logRes.ok ? await logRes.json() : [];

  return (
    <div className="space-y-8">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="eyebrow">Webhooks</div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Event delivery, fully visible.</h1>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Endpoints that receive signed billing events.
            </p>
          </div>
          <NewEndpointButton />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.03em]">Endpoints</h2>
        {endpoints.length === 0 ? (
          <EmptyState
            title="No webhook endpoints registered"
            description="Add an HTTPS URL to receive signed POST requests when billing events fire."
            action={<NewEndpointButton />}
          />
        ) : (
          <div className="table-shell">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
                <tr>
                  <th className="px-5 py-3 font-medium">URL</th>
                  <th className="px-5 py-3 font-medium">Events</th>
                  <th className="px-5 py-3 font-medium">Active</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {endpoints.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 font-mono text-xs">{e.url}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">
                      {e.events?.length > 0 ? e.events.join(", ") : "all"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={e.active ? "Active" : "Cancelled"} />
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)] text-xs">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-[-0.03em]">Delivery log</h2>
        {log.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            description="Once a billing event fires, attempts (and retries) will appear here."
          />
        ) : (
          <div className="table-shell">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--muted)] border-b border-white/10">
                <tr>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">HTTP</th>
                  <th className="px-5 py-3 font-medium">Attempt</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {log.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-3"><StatusPill status={d.status} /></td>
                    <td className="px-5 py-3 font-mono text-xs">{d.event}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{d.httpStatus ?? "—"}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{d.attemptCount}</td>
                    <td className="px-5 py-3 text-[var(--muted)] text-xs">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
