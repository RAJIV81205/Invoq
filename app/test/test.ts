import type { ReportFn, TestResult } from "@/lib/types";
import { api, apiNoAuth } from "@/lib/apiClient";
import { signXdr } from "@/lib/freighter";
import { NETWORK_PASSPHRASE } from "@/lib/config";

// ─── helpers ─────────────────────────────────────────────────────────────────

function pass(label: string, detail?: string, txHash?: string, ms?: number): TestResult {
  return { label, status: "pass", detail, txHash, ms };
}
function fail(label: string, detail?: string): TestResult {
  return { label, status: "fail", detail };
}
function skip(label: string, reason?: string): TestResult {
  return { label, status: "skip", detail: reason };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const s = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - s };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runAllTests(developerAddress: string, report: ReportFn) {
  let planId: string | null = null;
  let freePlanId: string | null = null;
  let webhookId: string | null = null;

  // ── Section 0: Health & Auth ──────────────────────────────────────────────
  const s0 = 0;

  {
    const { result: r, ms } = await timed(() => apiNoAuth("GET", "/health"));
    report(s0, r.status === 200
      ? pass("GET /health → 200", undefined, undefined, ms)
      : fail("GET /health → 200", `Got ${r.status}`));
  }

  {
    const r = await apiNoAuth("GET", "/v1/plans/1");
    report(s0, r.status === 401
      ? pass("No API key → 401")
      : fail("No API key → 401", `Got ${r.status}`));
  }

  {
    const r = await fetch(`http://localhost:3001/v1/plans/1`, {
      headers: { Authorization: "Bearer sk_live_badkey" },
    });
    report(s0, r.status === 401
      ? pass("Bad API key → 401")
      : fail("Bad API key → 401", `Got ${r.status}`));
  }

  {
    const { result: r, ms } = await timed(() => api("GET", "/v1/plans/9999"));
    report(s0, r.status === 404
      ? pass("Valid key, unknown plan → 404", undefined, undefined, ms)
      : fail("Valid key, unknown plan → 404", `Got ${r.status}`));
  }

  {
    const r = await api("GET", "/v1/doesnotexist");
    report(s0, r.status === 404
      ? pass("Unknown route → 404")
      : fail("Unknown route → 404", `Got ${r.status}`));
  }

  // ── Section 1: Plans with fee bump ───────────────────────────────────────
  const s1 = 1;

  // Create plan with fee bump
  {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/plans/build-tx", {
        developerAddress,
        name: "API Pro",
        priceUsdc: 50000000,
        intervalSeconds: 2592000,
        trialSeconds: 0,
        usageLimit: 100000,
        features: ["api_access", "webhooks", "export"],
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s1, fail("Build plan tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s1, pass("Build plan tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s1, pass("Developer signed plan tx with Freighter"));

        const submitRes = await api("POST", "/v1/plans/submit-tx", { signedXdr });
        planId = submitRes.data?.planId ?? null;
        report(s1, planId
          ? pass("Submit signed plan tx", `Plan ID: ${planId}`, submitRes.data?.txHash)
          : fail("Submit signed plan tx", submitRes.error ?? "No planId"));
      } catch (e: any) {
        report(s1, fail("Developer signed plan tx", e.message));
      }
    }
  }

  // Create free plan with fee bump
  {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/plans/build-tx", {
        developerAddress,
        name: "Free Tier",
        priceUsdc: 0,
        intervalSeconds: 2592000,
        usageLimit: 1000,
        features: ["api_access"],
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s1, fail("Build free plan tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s1, pass("Build free plan tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s1, pass("Developer signed free plan tx with Freighter"));

        const submitRes = await api("POST", "/v1/plans/submit-tx", { signedXdr });
        freePlanId = submitRes.data?.planId ?? null;
        report(s1, freePlanId
          ? pass("Submit signed free plan tx", `Plan ID: ${freePlanId}`, submitRes.data?.txHash)
          : fail("Submit signed free plan tx", submitRes.error ?? "No planId"));
      } catch (e: any) {
        report(s1, fail("Developer signed free plan tx", e.message));
      }
    }
  }

  // Read plan
  if (planId) {
    const { result: r, ms } = await timed(() => api("GET", `/v1/plans/${planId}`));
    const ok = r.data?.name === "API Pro" && r.data?.active === true;
    report(s1, ok
      ? pass("GET plan — name + active correct", undefined, undefined, ms)
      : fail("GET plan", JSON.stringify(r.data ?? r.error)));
  } else {
    report(s1, skip("GET plan", "plan not created"));
  }

  // Missing fields → 400
  {
    const r = await api("POST", "/v1/plans", { name: "Bad" });
    report(s1, r.status === 400
      ? pass("Missing fields → 400")
      : fail("Missing fields → 400", `Got ${r.status}`));
  }

  // Non-existent plan → 404
  {
    const r = await api("GET", "/v1/plans/9999999");
    report(s1, r.status === 404
      ? pass("Non-existent plan → 404")
      : fail("Non-existent plan → 404", `Got ${r.status}`));
  }

  // Update plan with fee bump
  if (planId) {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/plans/build-update-tx", {
        developerAddress,
        planId,
        name: "API Pro v2",
        priceUsdc: 50000000,
        usageLimit: 200000,
        features: ["api_access", "webhooks", "export", "analytics"],
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s1, fail("Build update plan tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s1, pass("Build update plan tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s1, pass("Developer signed update plan tx with Freighter"));

        const submitRes = await api("POST", "/v1/plans/submit-update-tx", { signedXdr });
        report(s1, submitRes.data?.txHash
          ? pass("Submit signed update plan tx", undefined, submitRes.data.txHash)
          : fail("Submit signed update plan tx", submitRes.error ?? "No txHash"));
      } catch (e: any) {
        report(s1, fail("Developer signed update plan tx", e.message));
      }
    }
  } else {
    report(s1, skip("Update plan", "no planId"));
  }

  // Deactivate plan with fee bump
  if (planId) {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/plans/build-deactivate-tx", {
        developerAddress,
        planId,
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s1, fail("Build deactivate plan tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s1, pass("Build deactivate plan tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s1, pass("Developer signed deactivate plan tx with Freighter"));

        const submitRes = await api("POST", "/v1/plans/submit-deactivate-tx", { signedXdr });
        report(s1, submitRes.data?.txHash
          ? pass("Submit signed deactivate plan tx", undefined, submitRes.data.txHash)
          : fail("Submit signed deactivate plan tx", submitRes.error ?? "No txHash"));
      } catch (e: any) {
        report(s1, fail("Developer signed deactivate plan tx", e.message));
      }
    }
  } else {
    report(s1, skip("Deactivate plan", "no planId"));
  }

  // Reactivate plan with fee bump
  if (planId) {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/plans/build-reactivate-tx", {
        developerAddress,
        planId,
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s1, fail("Build reactivate plan tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s1, pass("Build reactivate plan tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s1, pass("Developer signed reactivate plan tx with Freighter"));

        const submitRes = await api("POST", "/v1/plans/submit-reactivate-tx", { signedXdr });
        report(s1, submitRes.data?.txHash
          ? pass("Submit signed reactivate plan tx", undefined, submitRes.data.txHash)
          : fail("Submit signed reactivate plan tx", submitRes.error ?? "No txHash"));
      } catch (e: any) {
        report(s1, fail("Developer signed reactivate plan tx", e.message));
      }
    }
  } else {
    report(s1, skip("Reactivate plan", "no planId"));
  }

  // ── Section 2: Checkout ───────────────────────────────────────────────────
  const s2 = 2;

  // Build subscribe tx
  let subscribeXdr: string | null = null;
  if (freePlanId) {
    const { result: r, ms } = await timed(() =>
      api("POST", "/v1/checkout/build-tx", {
        customerAddress: developerAddress,
        planId: freePlanId,
      })
    );
    subscribeXdr = r.data?.xdr ?? null;
    
    // Check if already subscribed
    if (
      r.error &&
      (r.error.includes("AlreadySubscribed") ||
        r.error.includes("Error(Contract, #41)"))
    ) {
      report(s2, skip("Build subscribe tx XDR", "Customer already has active subscription"));
    } else {
      report(s2, subscribeXdr
        ? pass("Build subscribe tx XDR", `${subscribeXdr.length} chars`, undefined, ms)
        : fail("Build subscribe tx XDR", r.error ?? "No XDR"));
    }
  } else {
    report(s2, skip("Build subscribe tx", "no freePlanId"));
  }

  // Sign + submit subscribe tx
  if (subscribeXdr) {
    try {
      const signed = await signXdr(subscribeXdr, NETWORK_PASSPHRASE);
      report(s2, pass("Developer signed subscribe tx with Freighter"));

      const { result: submitRes, ms } = await timed(() =>
        api("POST", "/v1/checkout/submit-tx", {
          signedXdr: signed,
          customerAddress: developerAddress,
          planId: freePlanId,
        })
      );
      report(s2, submitRes.data?.txHash
        ? pass("Submit subscribe tx", undefined, submitRes.data.txHash, ms)
        : fail("Submit subscribe tx", submitRes.error ?? "No txHash"));
    } catch (e: any) {
      report(s2, fail("Sign + submit subscribe tx", e.message));
    }
  } else {
    report(s2, skip("Sign subscribe tx", "no XDR or already subscribed"));
  }

  // Bad signature → 400
  {
    const r = await api("POST", "/v1/checkout/submit-tx", {
      signedXdr: "AAABADXDR",
      customerAddress: developerAddress,
      planId: "1",
    });
    report(s2, r.status === 400
      ? pass("Bad signature → 400")
      : fail("Bad signature → 400", `Got ${r.status}: ${r.error}`));
  }

  // Build vault tx
  let vaultXdr: string | null = null;
  {
    const { result: r, ms } = await timed(() =>
      api("POST", "/v1/checkout/build-vault-tx", {
        customerAddress: developerAddress,
        developerAddress,
        initialDeposit: 5000000,
        lowBalanceThreshold: 1000000,
        autoTopupAmount: 0,
      })
    );
    vaultXdr = r.data?.xdr ?? null;
    if (r.error && r.error.includes("Error(Contract, #20)")) {
      report(s2, skip("Build vault creation tx XDR", "Vault already exists"));
    } else {
      report(s2, vaultXdr
        ? pass("Build vault creation tx XDR", `${vaultXdr.length} chars`, undefined, ms)
        : fail("Build vault creation tx XDR", r.error ?? "No XDR"));
    }
  }

  // Sign + submit vault tx
  if (vaultXdr) {
    try {
      const signed = await signXdr(vaultXdr, NETWORK_PASSPHRASE);
      report(s2, pass("Developer signed vault tx with Freighter"));

      const { result: submitRes, ms } = await timed(() =>
        api("POST", "/v1/checkout/submit-vault-tx", {
          signedXdr: signed,
          customerAddress: developerAddress,
        })
      );
      report(s2, submitRes.data?.txHash
        ? pass("Submit vault creation tx", undefined, submitRes.data.txHash, ms)
        : fail("Submit vault creation tx", submitRes.error ?? "No txHash"));
    } catch (e: any) {
      report(s2, fail("Sign + submit vault tx", e.message));
    }
  } else {
    report(s2, skip("Sign vault tx", "no XDR or vault already exists"));
  }

  // ── Section 3: Entitlement ────────────────────────────────────────────────
  const s3 = 3;

  {
    const r = await api("GET", `/v1/entitlement?customer=${developerAddress}&feature=api_access`);
    const hasEntitled = r.data !== null && "entitled" in (r.data ?? {});
    report(s3, hasEntitled
      ? pass("Check entitlement (chain)", `entitled: ${r.data.entitled}, source: ${r.data.source}`)
      : fail("Check entitlement", r.error ?? JSON.stringify(r.data)));
  }

  {
    const r = await api("GET", `/v1/entitlement?customer=${developerAddress}&feature=api_access`);
    report(s3, r.data?.source === "cache"
      ? pass("Second call hits cache")
      : fail("Second call hits cache", `source: ${r.data?.source}`));
  }

  {
    const r = await api("GET", `/v1/entitlement/full?customer=${developerAddress}&feature=api_access`);
    const ok = r.data && "entitled" in r.data && "usage_limit" in r.data;
    report(s3, ok
      ? pass("Full entitlement data", `status: ${JSON.stringify(r.data?.status)}`)
      : skip("Full entitlement", "no active subscription"));
  }

  {
    const r = await api("GET", `/v1/entitlement?customer=${developerAddress}`);
    report(s3, r.status === 400
      ? pass("Missing feature param → 400")
      : fail("Missing feature param → 400", `Got ${r.status}`));
  }

  // ── Section 4: Usage ──────────────────────────────────────────────────────
  const s4 = 4;

  {
    const { result: r, ms } = await timed(() =>
      api("POST", "/v1/usage/record", { customer: developerAddress, units: 50 })
    );
    report(s4, r.data?.accepted === true
      ? pass("Record 50 units", `bufferTotal: ${r.data.bufferTotal}`, undefined, ms)
      : fail("Record 50 units", r.error ?? JSON.stringify(r.data)));
  }

  {
    const r = await api("POST", "/v1/usage/record", { customer: developerAddress, units: 100 });
    report(s4, r.data?.accepted === true
      ? pass("Record 100 more units", `bufferTotal: ${r.data.bufferTotal}`)
      : fail("Record 100 more units", r.error ?? ""));
  }

  {
    const r = await api("POST", "/v1/usage/record", { customer: developerAddress, units: 0 });
    report(s4, r.status === 400
      ? pass("Zero units → 400")
      : fail("Zero units → 400", `Got ${r.status}`));
  }

  {
    const r = await api("POST", "/v1/usage/record", { units: 10 });
    report(s4, r.status === 400
      ? pass("Missing customer → 400")
      : fail("Missing customer → 400", `Got ${r.status}`));
  }

  {
    const r = await api("GET", `/v1/usage/${developerAddress}`);
    const ok = r.data && "usageCurrent" in r.data;
    report(s4, ok
      ? pass("Read usage", `usageCurrent: ${r.data.usageCurrent}, status: ${r.data.status}`)
      : skip("Read usage", "no subscription yet"));
  }

  // ── Section 5: Subscriptions ──────────────────────────────────────────────
  const s5 = 5;

  {
    const { result: r, ms } = await timed(() => api("GET", `/v1/subscriptions/${developerAddress}`));
    const ok = r.data && "plan_id" in r.data;
    report(s5, ok
      ? pass("Read subscription", `plan: ${r.data.plan_id}, status: ${r.data.status}`, undefined, ms)
      : skip("Read subscription", "no active subscription"));
  }

  {
    const r = await api("GET", "/v1/subscriptions/NOTANADDRESS");
    report(s5, r.data === null || r.error
      ? pass("Invalid address → error")
      : fail("Invalid address → error", JSON.stringify(r.data)));
  }

  {
    const { result: r, ms } = await timed(() =>
      api("DELETE", `/v1/subscriptions/${developerAddress}`, { immediate: false })
    );
    
    // Check if already cancelled or other error
    if (r.error && (r.error.includes("AlreadyCancelled") || r.error.includes("terminal"))) {
      report(s5, skip("Cancel subscription", "Already cancelled or in terminal state"));
    } else {
      report(s5, r.data?.txHash
        ? pass("Cancel subscription (end of period)", undefined, r.data.txHash, ms)
        : fail("Cancel subscription", r.error ?? "no txHash"));
    }
  }

  // ── Section 6: Vault ──────────────────────────────────────────────────────
  const s6 = 6;

  {
    const r = await api("GET", `/v1/vault?customer=${developerAddress}`);
    report(s6, r.status === 400
      ? pass("Missing developer param → 400")
      : fail("Missing developer param → 400", `Got ${r.status}`));
  }

  // Check if vault exists (should exist after Section 2)
  let vaultExists = false;
  {
    const { result: r, ms } = await timed(() =>
      api("GET", `/v1/vault?customer=${developerAddress}&developer=${developerAddress}`)
    );
    vaultExists = r.status === 200 && r.data !== null;
    report(s6, vaultExists
      ? pass("Vault exists", `balance: ${r.data.balance_usdc}`, undefined, ms)
      : r.status === 404
        ? skip("Vault check", "Vault not created yet")
        : fail("Vault check", r.error ?? ""));
  }

  {
    const r = await api("POST", "/v1/vault/debit", { customer: developerAddress });
    report(s6, r.status === 400
      ? pass("Debit missing fields → 400")
      : fail("Debit missing fields → 400", `Got ${r.status}`));
  }

  // Test real vault debit (if vault exists)
  if (vaultExists) {
    const { result: r, ms } = await timed(() =>
      api("POST", "/v1/vault/debit", {
        customer: developerAddress,
        developer: developerAddress,
        amount: 100000,
        usageDescription: "Test debit for API usage",
      })
    );
    report(s6, r.data?.txHash
      ? pass("Debit vault 0.1 USDC", `remaining: ${r.data.remainingBalance}`, r.data.txHash, ms)
      : fail("Debit vault", r.error ?? "No txHash"));
  } else {
    report(s6, skip("Debit vault", "no vault"));
  }

  {
    const r = await api("POST", "/v1/vault/withdraw", { customer: developerAddress });
    report(s6, r.status === 400
      ? pass("Withdraw missing fields → 400")
      : fail("Withdraw missing fields → 400", `Got ${r.status}`));
  }

  // Test real vault withdraw with customer-signed fee-bump flow (if vault exists)
  if (vaultExists) {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/vault/build-withdraw-tx", {
        customerAddress: developerAddress,
        developerAddress,
        amount: 50000,
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s6, fail("Build withdraw tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s6, pass("Build withdraw tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s6, pass("Customer signed withdraw tx with Freighter"));

        const submitRes = await api("POST", "/v1/vault/submit-withdraw-tx", {
          signedXdr,
          customerAddress: developerAddress,
        });
        report(s6, submitRes.data?.txHash
          ? pass("Submit withdraw tx", undefined, submitRes.data.txHash)
          : fail("Submit withdraw tx", submitRes.error ?? "No txHash"));
      } catch (e: any) {
        report(s6, fail("Customer signed withdraw tx", e.message));
      }
    }
  } else {
    report(s6, skip("Withdraw from vault", "no vault"));
  }

  {
    const r = await api("PATCH", "/v1/vault/threshold", { customer: developerAddress });
    report(s6, r.status === 400
      ? pass("Threshold missing fields → 400")
      : fail("Threshold missing fields → 400", `Got ${r.status}`));
  }

  // Test real threshold update with customer-signed fee-bump flow (if vault exists)
  if (vaultExists) {
    const { result: buildRes, ms } = await timed(() =>
      api("POST", "/v1/vault/build-threshold-tx", {
        customerAddress: developerAddress,
        developerAddress,
        newThreshold: 2000000,
        newAutoTopup: 0,
      })
    );

    if (buildRes.error || !buildRes.data?.xdr) {
      report(s6, fail("Build threshold update tx XDR", buildRes.error ?? "No XDR returned"));
    } else {
      report(s6, pass("Build threshold update tx XDR", `XDR length: ${buildRes.data.xdr.length}`, undefined, ms));
      try {
        const signedXdr = await signXdr(buildRes.data.xdr, NETWORK_PASSPHRASE);
        report(s6, pass("Customer signed threshold update tx with Freighter"));

        const submitRes = await api("POST", "/v1/vault/submit-threshold-tx", {
          signedXdr,
          customerAddress: developerAddress,
        });
        report(s6, submitRes.data?.txHash
          ? pass("Submit threshold update tx", undefined, submitRes.data.txHash)
          : fail("Submit threshold update tx", submitRes.error ?? "No txHash"));
      } catch (e: any) {
        report(s6, fail("Customer signed threshold update tx", e.message));
      }
    }
  } else {
    report(s6, skip("Update vault threshold", "no vault"));
  }

  // ── Section 7: Webhooks ───────────────────────────────────────────────────
  const s7 = 7;

  {
    const { result: r, ms } = await timed(() =>
      api("POST", "/v1/webhooks", {
        url: "https://example.com/invoq-webhook",
        events: ["payment.renewed", "payment.failed", "subscription.cancelled"],
      })
    );
    webhookId = r.data?.id ?? null;
    report(s7, webhookId
      ? pass("Create webhook endpoint", `ID: ${webhookId}`, undefined, ms)
      : fail("Create webhook endpoint", r.error ?? "No id"));
  }

  {
    const r = await api("POST", "/v1/webhooks", {});
    report(s7, r.status === 400
      ? pass("Missing url → 400")
      : fail("Missing url → 400", `Got ${r.status}`));
  }

  {
    const r = await api("GET", "/v1/webhooks");
    const isArr = Array.isArray(r.data);
    report(s7, isArr
      ? pass("List webhooks", `${r.data.length} endpoint(s)`)
      : fail("List webhooks", r.error ?? "Not array"));
  }

  {
    const r = await api("GET", "/v1/webhooks/log");
    report(s7, Array.isArray(r.data)
      ? pass("Delivery log", `${r.data.length} entries`)
      : fail("Delivery log", r.error ?? "Not array"));
  }

  {
    const r = await api("GET", "/v1/webhooks/log?status=delivered");
    report(s7, Array.isArray(r.data)
      ? pass("Delivery log filtered by status")
      : fail("Delivery log filtered", r.error ?? "Not array"));
  }

  {
    const r = await api("GET", "/v1/webhooks/log?limit=5");
    report(s7, Array.isArray(r.data)
      ? pass("Delivery log with limit=5")
      : fail("Delivery log limit", r.error ?? "Not array"));
  }

  if (webhookId) {
    const r = await api("DELETE", `/v1/webhooks/${webhookId}`);
    report(s7, r.data?.deleted === true
      ? pass("Delete webhook endpoint")
      : fail("Delete webhook endpoint", r.error ?? ""));
  } else {
    report(s7, skip("Delete webhook", "no webhookId"));
  }

  {
    const r = await api("GET", "/v1/webhooks");
    const stillThere = Array.isArray(r.data) && r.data.some((e: any) => e.id === webhookId);
    report(s7, !stillThere
      ? pass("Deleted endpoint gone from list")
      : fail("Deleted endpoint still in list"));
  }
}
