// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Entitlement (server-side)
// Hot path — called on every API request to gate feature access.
// Backed by Redis cache (10s TTL) → Soroban contract fallback.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http.js";
import type { EntitlementResult, EntitlementFullResult } from "../shared/types.js";

export class EntitlementResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Check if a customer is entitled to a feature.
   * Fast path: checks Redis cache first (10s TTL), falls back to Soroban query.
   *
   * Use this on every incoming API request to gate access.
   *
   * @example
   * const { entitled } = await invoq.entitlement.check(
   *   customerAddress,
   *   "api:pro"
   * );
   * if (!entitled) {
   *   return res.status(403).json({ error: "Upgrade required" });
   * }
   */
  async check(
    customerAddress: string,
    feature: string,
  ): Promise<EntitlementResult> {
    return this.http.get<EntitlementResult>("/v1/entitlement", {
      customer: customerAddress,
      feature,
    });
  }

  /**
   * Check entitlement with full subscription context.
   * Returns status, plan ID, usage counters, period end — slower than check().
   * Use for usage dashboards or when you need the full picture.
   *
   * Requires sk_ key (server-only).
   *
   * @example
   * const result = await invoq.entitlement.checkFull(customerAddress, "api:pro");
   * console.log(result.usage_current, "/", result.usage_limit);
   */
  async checkFull(
    customerAddress: string,
    feature: string,
  ): Promise<EntitlementFullResult> {
    return this.http.get<EntitlementFullResult>("/v1/entitlement/full", {
      customer: customerAddress,
      feature,
    });
  }

  /**
   * Convenience: returns a boolean directly. Swallows NOT_FOUND (returns false).
   * Useful when you want a simple guard without try/catch.
   *
   * @example
   * if (!(await invoq.entitlement.isAllowed(address, "feature:x"))) {
   *   return res.status(403).end();
   * }
   */
  async isAllowed(customerAddress: string, feature: string): Promise<boolean> {
    try {
      const result = await this.check(customerAddress, feature);
      return result.entitled;
    } catch (err: unknown) {
      // No subscription found → not entitled
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "NOT_FOUND_ERROR"
      ) {
        return false;
      }
      // Any other error re-throw so caller knows something went wrong
      throw err;
    }
  }
}