import { API_BASE_URL, API_KEY } from "./config";

interface ApiResponse<T = any> {
  data: T | null;
  status: number;
  error: string | null;
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const start = Date.now();
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
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }

    return {
      data: res.ok ? data : null,
      status: res.status,
      error: !res.ok ? (data?.error ?? text) : null,
    };
  } catch (e: any) {
    return { data: null, status: 0, error: e.message };
  }
}

export async function apiNoAuth(method: string, path: string): Promise<ApiResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method });
    return { data: null, status: res.status, error: null };
  } catch (e: any) {
    return { data: null, status: 0, error: e.message };
  }
}