// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Plans (server-side)
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http";
import type {
  Plan,
  CreatePlanParams,
  UpdatePlanParams,
  CreatePlanResult,
  UpdatePlanResult,
} from "../shared/types.js";

export class PlansResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a subscription plan. Uses admin-signed server-side flow.
   * Returns planId and txHash once on-chain.
   *
   * @example
   * const { planId } = await invoq.plans.create({
   *   name: "Pro",
   *   priceUsdc: 29_000_000,   // 29 USDC
   *   intervalSeconds: 2592000, // 30 days
   *   trialSeconds: 1209600,    // 14 days
   *   usageLimit: 100_000,
   *   features: ["api:pro", "rate:100rps"],
   * });
   */
  async create(params: CreatePlanParams): Promise<CreatePlanResult> {
    return this.http.post<CreatePlanResult>("/v1/plans", {
      name:            params.name,
      priceUsdc:       Number(params.priceUsdc),
      intervalSeconds: Number(params.intervalSeconds),
      trialSeconds:    Number(params.trialSeconds ?? 0),
      usageLimit:      Number(params.usageLimit ?? 0),
      features:        params.features ?? [],
    });
  }

  /**
   * Fetch a plan by its on-chain ID.
   * Throws NOT_FOUND_ERROR if plan does not exist.
   */
  async get(planId: string | number | bigint): Promise<Plan> {
    return this.http.get<Plan>(`/v1/plans/${String(planId)}`);
  }

  /**
   * Update a plan's name, price, usage limit, or features.
   * Note: price/interval changes apply to next renewal, not current period.
   */
  async update(
    planId: string | number | bigint,
    params: UpdatePlanParams,
  ): Promise<UpdatePlanResult> {
    return this.http.patch<UpdatePlanResult>(`/v1/plans/${String(planId)}`, {
      name:       params.name,
      priceUsdc:  Number(params.priceUsdc),
      usageLimit: Number(params.usageLimit ?? 0),
      features:   params.features ?? [],
    });
  }

  /**
   * Deactivate a plan — existing subscribers continue, new subscribers blocked.
   */
  async deactivate(planId: string | number | bigint): Promise<{ txHash: string }> {
    return this.http.del<{ txHash: string }>(`/v1/plans/${String(planId)}`);
  }

  /**
   * Reactivate a previously deactivated plan.
   */
  async reactivate(planId: string | number | bigint): Promise<{ txHash: string }> {
    return this.http.post<{ txHash: string }>(`/v1/plans/${String(planId)}/reactivate`);
  }
}