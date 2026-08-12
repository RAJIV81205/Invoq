"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { connectFreighter, getFreighterAddress, signXdr } from "@/lib/freighter";
import styles from "./demo-store.module.css";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const STROOPS_PER_USDC = 10_000_000;
const STORAGE_KEY = "invoq-demo-store-config";

type Plan = {
  plan_id: string;
  name: string;
  price_usdc: string;
  interval_seconds: string;
  trial_seconds: string;
  usage_limit: string;
  features: string[];
  active: boolean;
};

type DemoConfig = {
  apiBaseUrl: string;
  publishableKey: string;
  planId: string;
};

type CheckoutState =
  | "idle"
  | "connecting"
  | "approving"
  | "building"
  | "signing"
  | "submitting"
  | "success";

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message) {
    if (value.message.includes("not enough allowance")) {
      return "USDC permission is missing. Approve BillingCycle in Freighter, then retry.";
    }
    if (value.message.includes("balance") || value.message.includes("Balance")) {
      return "Customer wallet needs enough Testnet USDC for this subscription.";
    }
    return value.message.length > 280 ? `${value.message.slice(0, 277)}…` : value.message;
  }
  return "Checkout failed. Check API URL, publishable key, plan ID, and Freighter network.";
}

function shortAddress(value: string): string {
  return `${value.slice(0, 7)}…${value.slice(-6)}`;
}

function intervalLabel(seconds: string): string {
  const days = Number(seconds) / 86_400;
  if (days === 30) return "month";
  if (days === 365) return "year";
  if (Number.isInteger(days)) return `${days} days`;
  return `${seconds} seconds`;
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return <span className={styles.codeLine}>{children}</span>;
}

export default function DemoStorefront({ defaultApiBaseUrl }: { defaultApiBaseUrl: string }) {
  const [config, setConfig] = useState<DemoConfig>({
    apiBaseUrl: defaultApiBaseUrl,
    publishableKey: "",
    planId: "",
  });
  const [setupOpen, setSetupOpen] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [existingSubscriptionStatus, setExistingSubscriptionStatus] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [walletNotice, setWalletNotice] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<DemoConfig>;
      const frame = window.requestAnimationFrame(() => {
        setConfig((current) => ({
          apiBaseUrl: parsed.apiBaseUrl || current.apiBaseUrl,
          publishableKey: parsed.publishableKey || "",
          planId: parsed.planId || "",
        }));
      });
      return () => window.cancelAnimationFrame(frame);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const apiBaseUrl = useMemo(() => config.apiBaseUrl.replace(/\/$/, ""), [config.apiBaseUrl]);
  const configured = Boolean(plan && config.publishableKey && config.planId);
  const price = plan ? (Number(plan.price_usdc) / STROOPS_PER_USDC).toFixed(2) : "—";

  async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Invoq-Key": config.publishableKey.trim(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : `Invoq API returned ${response.status}`);
    }
    return data as T;
  }

  async function applyIntegration() {
    setError("");
    setTxHash("");
    setExistingSubscriptionStatus("");
    if (!config.publishableKey.startsWith("pk_")) {
      setError("Use a publishable key beginning with pk_. Secret keys must never be placed in browser code.");
      return;
    }
    if (!/^\d+$/.test(config.planId) || Number(config.planId) < 1) {
      setError("Plan ID must be a positive number.");
      return;
    }

    setLoadingPlan(true);
    try {
      const loadedPlan = await apiRequest<Plan>(`/v1/plans/${config.planId}`);
      if (!loadedPlan.active) throw new Error("This plan is inactive. Choose an active plan.");
      setPlan(loadedPlan);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      setSetupOpen(false);
    } catch (err) {
      setPlan(null);
      setError(errorMessage(err));
    } finally {
      setLoadingPlan(false);
    }
  }

  async function connectWallet() {
    setError("");
    setCheckoutState("connecting");
    try {
      await connectFreighter();
      const address = await getFreighterAddress();
      setWalletAddress(address);
      setWalletNotice(`Wallet ${shortAddress(address)} connected on Stellar Testnet.`);
      setCheckoutState("idle");
      return address;
    } catch (err) {
      setCheckoutState("idle");
      setError(errorMessage(err));
      return null;
    }
  }

  async function subscribe() {
    if (!configured) {
      setSetupOpen(true);
      setError("Apply developer integration before opening checkout.");
      return;
    }

    setError("");
    setTxHash("");
    try {
      let customer = walletAddress;
      if (!customer) {
        setCheckoutState("connecting");
        await connectFreighter();
        customer = await getFreighterAddress();
        setWalletAddress(customer);
        setWalletNotice(`Wallet ${shortAddress(customer)} connected. Continue in Freighter to approve USDC.`);
      }

      const current = await apiRequest<{
        subscribed: boolean;
        status: string | null;
        planId: string | null;
      }>(`/v1/checkout/status?customerAddress=${encodeURIComponent(customer)}`);
      if (current.subscribed) {
        setExistingSubscriptionStatus(current.status ?? "Active");
        setCheckoutState("success");
        return;
      }

      setCheckoutState("approving");
      const approval = await apiRequest<{ xdr: string }>("/v1/checkout/build-approval-tx", {
        customerAddress: customer,
        planId: config.planId,
      });
      const signedApprovalXdr = await signXdr(approval.xdr, NETWORK_PASSPHRASE);
      await apiRequest<{ txHash: string }>("/v1/checkout/submit-approval-tx", {
        signedXdr: signedApprovalXdr,
        customerAddress: customer,
      });

      setCheckoutState("building");
      const built = await apiRequest<{ xdr: string }>("/v1/checkout/build-tx", {
        customerAddress: customer,
        planId: config.planId,
      });

      setCheckoutState("signing");
      const signedXdr = await signXdr(built.xdr, NETWORK_PASSPHRASE);

      setCheckoutState("submitting");
      const submitted = await apiRequest<{ txHash: string }>("/v1/checkout/submit-tx", {
        signedXdr,
        customerAddress: customer,
        planId: config.planId,
      });

      setTxHash(submitted.txHash);
      setCheckoutState("success");
    } catch (err) {
      if (err instanceof Error && err.message.includes("Contract, #41")) {
        setExistingSubscriptionStatus("Active");
        setCheckoutState("success");
        return;
      }
      setCheckoutState("idle");
      setError(errorMessage(err));
    }
  }

  const checkoutLabel: Record<CheckoutState, string> = {
    idle: walletAddress ? "Subscribe with USDC" : "Connect wallet & subscribe",
    connecting: "Connecting Freighter…",
    approving: "Approve USDC in Freighter…",
    building: "Preparing subscription…",
    signing: "Confirm in Freighter…",
    submitting: "Recording subscription…",
    success: "Subscription active",
  };
  const checkoutProgress: Partial<Record<CheckoutState, number>> = {
    connecting: 15,
    approving: 35,
    building: 55,
    signing: 75,
    submitting: 90,
    success: 100,
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/demo-store" className={styles.brand}>
          <span className={styles.brandMark}>M</span>
          <span>Morrow</span>
        </Link>
        <nav className={styles.nav} aria-label="Store navigation">
          <a href="#workbench">Workbench</a>
          <a href="#membership">Membership</a>
          <button type="button" onClick={() => setSetupOpen((open) => !open)} className={styles.integrationToggle}>
            <span className={configured ? styles.liveDot : styles.draftDot} />
            Invoq integration
          </button>
        </nav>
      </header>

      <section className={`${styles.integrationPanel} ${setupOpen ? styles.panelOpen : ""}`} aria-hidden={!setupOpen}>
        <div className={styles.integrationIntro}>
          <p className={styles.kicker}>Developer setup · browser integration</p>
          <h2>Connect this storefront to Invoq.</h2>
          <p>Paste publishable key and plan ID created in dashboard. Values stay in this browser.</p>
        </div>
        <div className={styles.fields}>
          <label>
            API base URL
            <input
              autoComplete="off"
              value={config.apiBaseUrl}
              onChange={(event) => setConfig({ ...config, apiBaseUrl: event.target.value })}
              placeholder="http://localhost:3001"
            />
          </label>
          <label>
            Publishable key
            <input
              type="password"
              autoComplete="off"
              value={config.publishableKey}
              onChange={(event) => setConfig({ ...config, publishableKey: event.target.value })}
              placeholder="pk_live_…"
            />
          </label>
          <label className={styles.planField}>
            Plan ID
            <input
              inputMode="numeric"
              autoComplete="off"
              value={config.planId}
              onChange={(event) => setConfig({ ...config, planId: event.target.value })}
              placeholder="1"
            />
          </label>
          <button type="button" className={styles.applyButton} onClick={applyIntegration} disabled={loadingPlan}>
            {loadingPlan ? "Checking…" : "Apply integration"}
          </button>
        </div>
        <div className={styles.codeCard} aria-label="Integration code preview">
          <div className={styles.codeTop}><span /><span /><span /><b>checkout.ts</b></div>
          <code>
            <CodeLine><i>const</i> invoq = <i>new</i> InvoqClient({`{`}</CodeLine>
            <CodeLine>&nbsp;&nbsp;apiKey: <em>process.env.NEXT_PUBLIC_INVOQ_KEY</em>,</CodeLine>
            <CodeLine>{`}`});</CodeLine>
            <CodeLine>&nbsp;</CodeLine>
            <CodeLine><i>await</i> invoq.checkout.subscribe(</CodeLine>
            <CodeLine>&nbsp;&nbsp;wallet, customerAddress, <em>&quot;{config.planId || "PLAN_ID"}&quot;</em></CodeLine>
            <CodeLine>);</CodeLine>
          </code>
        </div>
      </section>

      <section className={styles.hero} id="workbench">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>A quieter place for loud ideas</p>
          <h1>Turn a rough thought into a finished sound.</h1>
          <p className={styles.lede}>
            Morrow gives independent creators a private AI workbench for voice, music, and the strange space between.
          </p>
          <div className={styles.heroActions}>
            <a href="#membership" className={styles.primaryLink}>See membership</a>
            <span>No card. Pay in USDC on Stellar.</span>
          </div>
        </div>

        <div className={styles.instrument} aria-label="Audio workbench preview">
          <div className={styles.instrumentTop}>
            <span>ROUGH CUT / 04:12</span>
            <span className={styles.recording}>LIVE SIGNAL</span>
          </div>
          <div className={styles.waveform} aria-hidden="true">
            {[32, 48, 65, 38, 82, 54, 92, 43, 74, 58, 87, 45, 70, 30, 60, 78, 48, 92, 55, 72, 41, 64, 35, 52].map((height, index) => (
              <span key={index} style={{ height: `${height}%`, animationDelay: `${index * -70}ms` }} />
            ))}
          </div>
          <div className={styles.transport}>
            <button type="button" aria-label="Previous">↤</button>
            <button type="button" className={styles.play} aria-label="Play">▶</button>
            <button type="button" aria-label="Next">↦</button>
            <div className={styles.timeline}><span /></div>
            <span>96 BPM</span>
          </div>
        </div>
      </section>

      <section className={styles.membership} id="membership">
        <div className={styles.membershipCopy}>
          <p className={styles.kicker}>One membership. Every instrument.</p>
          <h2>{plan?.name ?? "Studio membership"}</h2>
          <p>
            Unlimited private projects, lossless exports, commercial rights, and every new creative instrument we release.
          </p>
          <ul>
            {(plan?.features?.length ? plan.features : ["Unlimited workbench sessions", "Lossless exports", "Commercial licence"]).map((feature) => (
              <li key={feature}><span>✓</span>{feature.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>

        <div className={styles.checkoutCard}>
          <div className={styles.priceRow}>
            <span className={styles.price}><sup>$</sup>{price}</span>
            <span>USDC<br />per {plan ? intervalLabel(plan.interval_seconds) : "month"}</span>
          </div>
          {plan && Number(plan.trial_seconds) > 0 && (
            <p className={styles.trial}>{Math.round(Number(plan.trial_seconds) / 86_400)} days free, then recurring</p>
          )}

          {walletAddress && (
            <div className={styles.walletRow}>
              <span className={styles.liveDot} />
              Freighter · {shortAddress(walletAddress)}
              <button type="button" onClick={connectWallet}>Change</button>
            </div>
          )}

          {walletNotice && <p className={styles.walletNotice} role="status">{walletNotice}</p>}

          {checkoutState === "idle" && !txHash && (
            <ol className={styles.checkoutSteps} aria-label="Checkout steps">
              <li><span>1</span>Connect Freighter on Testnet</li>
              <li><span>2</span>Approve USDC spending</li>
              <li><span>3</span>Confirm subscription</li>
            </ol>
          )}

          {checkoutState === "success" ? (
            <div className={styles.success}>
              <span className={styles.successMark}>✓</span>
              <div>
                <strong>{existingSubscriptionStatus ? `Membership ${existingSubscriptionStatus.toLowerCase()}` : "Membership active"}</strong>
                <p>
                  {existingSubscriptionStatus
                    ? "This wallet already has a subscription. No duplicate charge was made."
                    : "Invoq recorded this customer and subscription."}
                </p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.checkoutButton}
              onClick={subscribe}
              disabled={!configured || checkoutState !== "idle"}
            >
              {configured ? checkoutLabel[checkoutState] : "Complete developer setup"}
            </button>
          )}

          {checkoutState !== "idle" && checkoutState !== "success" && (
            <div className={styles.checkoutProgress} role="progressbar" aria-label={checkoutLabel[checkoutState]} aria-valuenow={checkoutProgress[checkoutState]} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${checkoutProgress[checkoutState]}%` }} />
              <span>{checkoutLabel[checkoutState]}</span>
            </div>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          {txHash && (
            <div className={styles.receipt}>
              <span>Stellar transaction</span>
              <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer">
                {txHash.slice(0, 12)}…{txHash.slice(-8)} ↗
              </a>
            </div>
          )}

          <p className={styles.secureNote}>
            Powered by <strong>Invoq</strong> · Wallet signature required · Testnet
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Morrow is a fictional product built to demonstrate Invoq checkout.</span>
        <Link href="/dashboard/customers">View recorded customer in Invoq →</Link>
      </footer>
    </main>
  );
}
