import { API_BASE_URL, API_KEY } from "./config";

interface DefaultApiData {
  key?: string;
  keyId?: string;
  revoked?: boolean;
  xdr?: string;
  planId?: string;
  txHash?: string;
  name?: string;
  active?: boolean;
  entitled?: boolean;
  source?: "onchain" | "cache" | string;
  status?: string;
  usageCurrent?: number;
  plan_id?: string | number;
  balance_usdc?: string | number;
  accepted?: boolean;
  bufferTotal?: number;
  pending?: boolean;
  warning?: string;
  remainingBalance?: string | number;
  id?: string;
  deleted?: boolean;
  stellarAddress?: string;
  plans?: unknown[];
  subscriptions?: unknown[];
  vaults?: unknown[];
  allowed?: boolean;
  events?: unknown[];
}

interface ApiResponse<T = DefaultApiData> {
  data: T | null;
  status: number;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasError(data: unknown): data is { error: string } {
  return typeof data === "object"
    && data !== null
    && "error" in data
    && typeof (data as { error?: unknown }).error === "string";
}

export async function api<T = DefaultApiData>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = text; }

    return {
      data: res.ok ? data as T : null,
      status: res.status,
      error: !res.ok ? (hasError(data) ? data.error : text) : null,
    };
  } catch (e: unknown) {
    return { data: null, status: 0, error: getErrorMessage(e) };
  }
}

export async function apiNoAuth(method: string, path: string): Promise<ApiResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method });
    return { data: null, status: res.status, error: null };
  } catch (e: unknown) {
    return { data: null, status: 0, error: getErrorMessage(e) };
  }
}
