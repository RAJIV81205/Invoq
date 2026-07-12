export type JsonObject = Record<string, unknown>;

export interface ApiErrorBody {
  error?: string;
}

export interface DashboardPlan {
  plan_id: string | number;
  name: string;
  price_usdc: string | number;
  interval_seconds: string | number;
  trial_seconds: string | number;
  usage_limit: string | number;
  features?: string[];
  active: boolean;
  owner?: string;
  created_at?: string | number;
  active_subscribers?: number;
  total_subscribers?: number;
}

export interface DashboardSubscription {
  customerAddress: string;
  planId: string | number;
  status: string;
  currentPeriodEnd: string | number | Date;
  usageCurrent: number;
}

export interface OnChainSubscription {
  status: string;
  plan_id: string | number;
  current_period_end: string | number;
  usage_current: string | number;
}

export interface DashboardApiKey {
  id: string;
  name: string | null;
  type: string;
  env: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events?: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: string;
  httpStatus?: number | null;
  attemptCount?: number;
  createdAt: string;
  deliveredAt?: string | null;
}

export interface VaultBalance {
  customer: string;
  balance_usdc: string | number;
  total_deposited: string | number;
  total_debited: string | number;
  low_balance_threshold: string | number;
  created_at: string | number;
}
