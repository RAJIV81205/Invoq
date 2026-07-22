import { requireSession } from "@/app/lib/auth-cookie";
import PayoutAddressForm from "./PayoutAddressForm";
import { StrKey } from "@stellar/stellar-sdk";

export default async function SettingsPage() {
  const session = await requireSession();
  const me = session.developer;

  const isValidPayout = me.payoutAddress ? StrKey.isValidEd25519PublicKey(me.payoutAddress) : false;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="surface rounded-[2rem] p-6 sm:p-8">
        <div className="eyebrow">Settings</div>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Profile and payout.</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">Your developer profile and payout destination.</p>
      </div>

      <div className="surface rounded-[1.75rem] p-6 space-y-5">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Profile</h2>
        <Field label="Name"            value={me.name} />
        <Field label="Email"           value={me.email} />
        <Field label="Stellar address" value={me.stellarAddress} mono />
      </div>

      <div className="surface rounded-[1.75rem] p-6 space-y-5">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Payout destination</h2>
        <p className="text-sm leading-6 text-[var(--muted)]">
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
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)] mb-1.5">{label}</div>
      <div className={mono ? "font-mono text-sm break-all" : "text-sm"}>{value}</div>
    </div>
  );
}
