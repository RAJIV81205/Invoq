import { requireSession, apiFetch } from "@/app/lib/auth-cookie";
import PayoutAddressForm from "./PayoutAddressForm";
import { StrKey } from "@stellar/stellar-sdk";

export default async function SettingsPage() {
  const session = await requireSession();
  const res = await apiFetch(session, "/v1/developers/me");
  const me = res.ok ? await res.json() : session.developer;

  const isValidPayout = me.payoutAddress ? StrKey.isValidEd25519PublicKey(me.payoutAddress) : false;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Your developer profile and payout destination.</p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="font-semibold">Profile</h2>
        <Field label="Name"            value={me.name} />
        <Field label="Email"           value={me.email} />
        <Field label="Stellar address" value={me.stellarAddress} mono />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="font-semibold">Payout destination</h2>
        <p className="text-sm text-[var(--muted)]">
          The Stellar address that receives subscription revenue. Defaults to your developer address.
        </p>
        <PayoutAddressForm
          initial={me.payoutAddress ?? me.stellarAddress}
          isValid={isValidPayout}
        />
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase text-[var(--muted)] mb-1">{label}</div>
      <div className={mono ? "font-mono text-sm break-all" : "text-sm"}>{value}</div>
    </div>
  );
}
