// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Usage Metering (server-side)
// Records are buffered in Redis and flushed to Soroban every 5s by the job.
// POST /v1/usage/record → 202 Accepted (async — do not block your API on this)
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http.js";
import type { RecordUsageResult, UsageResult } from "../shared/types.js";
import { InvoqError } from "../shared/error";

export class UsageResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Record usage units for a customer. Fire-and-forget safe — returns 202.
   * Buffered in Redis, flushed to Soroban every 5 seconds by background job.
   *
   * Do NOT await this on the hot path if latency matters — use void:
   * `void invoq.usage.record(customer, 1);`
   *
   * @param customerAddress - Customer Stellar wallet address
   * @param units - Number of units consumed (tokens, API calls, tasks, etc.)
   *
   * @example
   * // Record 150 tokens used
   * await invoq.usage.record("GABC...XYZ", 150);
   *
   * // Non-blocking on hot path
   * void invoq.usage.record(customerAddress, tokensUsed);
   */
  async record(customerAddress: string, units: number): Promise<RecordUsageResult> {
    if (!customerAddress) {
      throw new InvoqError({
        message: "customerAddress is required",
        code: "VALIDATION_ERROR",
      });
    }
    if (!Number.isInteger(units) || units <= 0) {
      throw new InvoqError({
        message: `units must be a positive integer, got: ${units}`,
        code: "VALIDATION_ERROR",
      });
    }

    return this.http.post<RecordUsageResult>("/v1/usage/record", {
      customer: customerAddress,
      units,
    });
  }

  /**
   * Fetch current usage stats for a customer from Soroban state.
   * Shows current period consumption, period boundaries, and status.
   *
   * @example
   * const usage = await invoq.usage.get("GABC...XYZ");
   * const pct = Number(usage.usageCurrent) / Number(usage.periodEnd);
   */
  async get(customerAddress: string): Promise<UsageResult> {
    if (!customerAddress) {
      throw new InvoqError({
        message: "customerAddress is required",
        code: "VALIDATION_ERROR",
      });
    }
    return this.http.get<UsageResult>(`/v1/usage/${customerAddress}`);
  }
}