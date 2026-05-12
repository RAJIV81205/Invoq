// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Subscriptions (server-side)
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http";
import type { Subscription, CancelSubscriptionResult } from "../shared/types";
import { InvoqError } from "../shared/error";

export class SubscriptionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch the current subscription for a customer's Stellar address.
   * Throws NOT_FOUND_ERROR if no subscription exists.
   *
   * @example
   * const sub = await invoq.subscriptions.get("GABC...XYZ");
   * console.log(sub.status); // "Active"
   */
  async get(customerAddress: string): Promise<Subscription> {
    this.assertValidAddress(customerAddress);
    return this.http.get<Subscription>(`/v1/subscriptions/${customerAddress}`);
  }

  /**
   * Cancel a customer's subscription.
   *
   * @param customerAddress - Customer Stellar address
   * @param immediate - true = cancel now and stop access immediately.
   *                    false (default) = cancel at end of current period.
   *
   * @example
   * // Cancel at period end (default — customer keeps access until renewal)
   * await invoq.subscriptions.cancel("GABC...XYZ");
   *
   * // Immediate cancellation (access revoked now)
   * await invoq.subscriptions.cancel("GABC...XYZ", true);
   */
  async cancel(
    customerAddress: string,
    immediate = false,
  ): Promise<CancelSubscriptionResult> {
    this.assertValidAddress(customerAddress);
    return this.http.del<CancelSubscriptionResult>(
      `/v1/subscriptions/${customerAddress}`,
      { immediate },
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertValidAddress(address: string): void {
    if (!address || typeof address !== "string" || address.length !== 56) {
      throw new InvoqError({
        message: `Invalid Stellar address: "${address}". Must be a 56-character G... address.`,
        code: "VALIDATION_ERROR",
      });
    }
    if (!address.startsWith("G")) {
      throw new InvoqError({
        message: `Invalid Stellar address: "${address}". Ed25519 public keys start with "G".`,
        code: "VALIDATION_ERROR",
      });
    }
  }
}