// Server-side helpers for the dashboard. Reads the invoq_session cookie
// (set by the BFF) and resolves it to a developer record + API key.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { API_BASE_URL } from "./config";

export interface DashboardSession {
  apiKey: string;
  developer: {
    id: string;
    email: string;
    name: string;
    stellarAddress: string;
    payoutAddress: string | null;
  };
}

const getSessionForRequest = cache(async (): Promise<DashboardSession | null> => {
  const store = await cookies();
  const apiKey = store.get("invoq_session")?.value;
  if (!apiKey) return null;

  // Validate against the API. The /v1/developers/me endpoint will 401 if
  // the key has been revoked or expired.
  try {
    const res = await fetch(`${API_BASE_URL}/v1/developers/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const developer = await res.json();
    return { apiKey, developer };
  } catch {
    return null;
  }
});

export async function getSession(): Promise<DashboardSession | null> {
  return getSessionForRequest();
}

export async function requireSession(): Promise<DashboardSession> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/**
 * Server-side fetch wrapper that injects the dashboard session's API key.
 * Throws on non-2xx; the calling server component handles errors.
 */
export async function apiFetch(
  session: DashboardSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.apiKey}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  return res;
}
