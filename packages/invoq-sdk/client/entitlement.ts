// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Entitlement (client-side)
// Read-only check — safe to call from browser with pk_ key.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http.js";
import type { EntitlementResult } from "../shared/types.js";

export class ClientEntitlementResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Check if a customer wallet is entitled to a feature.
   * Safe to call from the browser — only reads entitlement state.
   *
   * @example
   * const { entitled } = await invoq.entitlement.check(walletAddress, "api:pro");
   * if (!entitled) showUpgradeModal();
   */
  async check(customerAddress: string, feature: string): Promise<EntitlementResult> {
    return this.http.get<EntitlementResult>("/v1/entitlement", {
      customer: customerAddress,
      feature,
    });
  }

  /**
   * Returns boolean directly. Swallows NOT_FOUND (returns false).
   *
   * @example
   * const canAccess = await invoq.entitlement.isAllowed(address, "feature:pro");
   */
  async isAllowed(customerAddress: string, feature: string): Promise<boolean> {
    try {
      const result = await this.check(customerAddress, feature);
      return result.entitled;
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "NOT_FOUND_ERROR"
      ) {
        return false;
      }
      throw err;
    }
  }
}