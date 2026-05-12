// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — HTTP Client
// Wraps native fetch. All errors surfaced as typed InvoqError subclasses.
// ─────────────────────────────────────────────────────────────────────────────

import {
  InvoqError,
  InvoqNetworkError,
  InvoqTimeoutError,
  buildApiError,
} from "./error";
import type { InvoqConfig } from "./types.js";

const DEFAULT_BASE_URL = "https://api.invoq.dev";
const DEFAULT_TIMEOUT  = 30_000;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly debug: boolean;

  constructor(config: InvoqConfig) {
    this.apiKey    = config.apiKey;
    this.baseUrl   = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.debug     = config.debug ?? false;

    if (!this.apiKey) {
      throw new InvoqError({
        message: "apiKey is required. Pass sk_live_... or pk_live_... in config.",
        code: "AUTH_ERROR",
      });
    }
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const method = opts.method ?? "GET";
    const url    = this.buildUrl(opts.path, opts.query);

    const headers: Record<string, string> = {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      "User-Agent":    "invoq-sdk/1.0.0",
    };
    if (this.apiKey.startsWith("pk_")) {
      headers["X-Invoq-Key"] = this.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), this.timeoutMs);

    if (this.debug) {
      console.debug(`[invoq-sdk] → ${method} ${url}`, opts.body ?? "");
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body:   opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);

      // AbortController fired → timeout
      if (err instanceof Error && err.name === "AbortError") {
        const timeoutErr = new InvoqTimeoutError(this.timeoutMs);
        if (this.debug) {
          console.error(`[invoq-sdk] ✗ TIMEOUT ${method} ${url} (${this.timeoutMs}ms)`);
        }
        throw timeoutErr;
      }

      // Network-level error (DNS, connection refused, etc.)
      const netErr = new InvoqNetworkError(
        `Network error on ${method} ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
      if (this.debug) {
        console.error(`[invoq-sdk] ✗ NETWORK ${method} ${url}`, netErr.cause);
      }
      throw netErr;
    } finally {
      clearTimeout(timer);
    }

    // ── Parse response body ───────────────────────────────────────────────────

    const rawText = await response.text().catch(() => "");

    let parsed: unknown = null;
    let parseError = false;

    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parseError = true;
      }
    }

    if (this.debug) {
      console.debug(
        `[invoq-sdk] ← ${response.status} ${method} ${url}`,
        parsed ?? rawText,
      );
    }

    // ── Handle non-2xx ───────────────────────────────────────────────────────

    if (!response.ok) {
      let body: Record<string, unknown> | null = null;
      if (!parseError && parsed !== null && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }

      const apiErr = buildApiError(response.status, body, rawText);

      if (this.debug) {
        console.error(
          `[invoq-sdk] ✗ ${response.status} ${method} ${url}`,
          `code=${apiErr.code}`,
          `message="${apiErr.message}"`,
          body ?? rawText,
        );
      }

      throw apiErr;
    }

    // ── Handle parse failure on success response ──────────────────────────────

    if (parseError) {
      const err = new InvoqError({
        message: `Failed to parse JSON response from ${method} ${url}. Body: ${rawText.slice(0, 200)}`,
        code: "PARSE_ERROR",
        statusCode: response.status,
        raw: rawText,
      });
      if (this.debug) {
        console.error(`[invoq-sdk] ✗ PARSE ${method} ${url}`, rawText);
      }
      throw err;
    }

    return parsed as T;
  }

  // ── Convenience methods ───────────────────────────────────────────────────

  get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>({ method: "GET", path, query });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", path, body });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body });
  }

  del<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "DELETE", path, body });
  }

  // ── URL builder ───────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    if (!query) return base;

    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (val !== undefined && val !== null) {
        params.set(key, String(val));
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }
}
