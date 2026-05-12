// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Error Classes
// ─────────────────────────────────────────────────────────────────────────────

export type InvoqErrorCode =
  | "NETWORK_ERROR"        // fetch threw — DNS, timeout, no internet
  | "HTTP_ERROR"           // got a response but status >= 400
  | "PARSE_ERROR"          // response body not valid JSON
  | "AUTH_ERROR"           // 401 — bad/missing/revoked API key
  | "FORBIDDEN_ERROR"      // 403 — wrong key type for this endpoint
  | "NOT_FOUND_ERROR"      // 404 — resource does not exist
  | "VALIDATION_ERROR"     // 400 — missing/invalid request params
  | "RATE_LIMIT_ERROR"     // 429 — too many requests
  | "UPSTREAM_ERROR"       // 502 — Stellar/contract call failed
  | "SERVER_ERROR"         // 500/503 — Invoq backend error
  | "TIMEOUT_ERROR"        // fetch AbortController timeout
  | "SIGNATURE_ERROR"      // webhook HMAC mismatch
  | "UNKNOWN_ERROR";

/**
 * Base class for all Invoq SDK errors.
 * Always has a `code` for programmatic handling.
 */
export class InvoqError extends Error {
  readonly code: InvoqErrorCode;
  readonly statusCode: number | null;
  readonly raw: unknown;

  constructor(opts: {
    message: string;
    code: InvoqErrorCode;
    statusCode?: number;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "InvoqError";
    this.code = opts.code;
    this.statusCode = opts.statusCode ?? null;
    this.raw = opts.raw ?? null;

    // Maintains proper stack trace in V8 (Node.js only)
    type ErrorWithCapture = typeof Error & {
      captureStackTrace?: (target: object, fn: object) => void;
    };
    (Error as ErrorWithCapture).captureStackTrace?.(this, InvoqError);
  }
}

/**
 * Thrown when the Invoq API returns an HTTP error response.
 * `body` holds the parsed JSON error payload if available.
 */
export class InvoqApiError extends InvoqError {
  readonly body: Record<string, unknown> | null;

  constructor(opts: {
    message: string;
    code: InvoqErrorCode;
    statusCode: number;
    body?: Record<string, unknown> | null;
    raw?: unknown;
  }) {
    super({ message: opts.message, code: opts.code, statusCode: opts.statusCode, raw: opts.raw });
    this.name = "InvoqApiError";
    this.body = opts.body ?? null;
  }
}

/**
 * Thrown when a network-level failure occurs (no response received).
 */
export class InvoqNetworkError extends InvoqError {
  readonly cause: Error | null;

  constructor(message: string, cause?: Error) {
    super({ message, code: "NETWORK_ERROR" });
    this.name = "InvoqNetworkError";
    this.cause = cause ?? null;
  }
}

/**
 * Thrown when the request times out.
 */
export class InvoqTimeoutError extends InvoqError {
  constructor(timeoutMs: number) {
    super({
      message: `Request timed out after ${timeoutMs}ms`,
      code: "TIMEOUT_ERROR",
    });
    this.name = "InvoqTimeoutError";
  }
}

/**
 * Thrown when webhook signature verification fails.
 */
export class InvoqSignatureError extends InvoqError {
  constructor(detail?: string) {
    super({
      message: detail ?? "Webhook signature verification failed",
      code: "SIGNATURE_ERROR",
    });
    this.name = "InvoqSignatureError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — map HTTP status → error code + class
// ─────────────────────────────────────────────────────────────────────────────

export function buildApiError(
  status: number,
  body: Record<string, unknown> | null,
  raw: unknown,
): InvoqApiError {
  const serverMessage =
    typeof body?.error === "string" ? body.error : `HTTP ${status}`;

  let code: InvoqErrorCode;
  switch (status) {
    case 400: code = "VALIDATION_ERROR"; break;
    case 401: code = "AUTH_ERROR";       break;
    case 403: code = "FORBIDDEN_ERROR";  break;
    case 404: code = "NOT_FOUND_ERROR";  break;
    case 429: code = "RATE_LIMIT_ERROR"; break;
    case 502: code = "UPSTREAM_ERROR";   break;
    case 500:
    case 503: code = "SERVER_ERROR";     break;
    default:  code = "HTTP_ERROR";       break;
  }

  return new InvoqApiError({
    message: serverMessage,
    code,
    statusCode: status,
    body,
    raw,
  });
}