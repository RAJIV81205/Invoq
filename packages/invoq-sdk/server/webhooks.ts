// ─────────────────────────────────────────────────────────────────────────────
// Invoq SDK — Webhooks (server-side)
// Manage webhook endpoints + verify incoming webhook payloads.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpClient } from "../shared/http.js";
import type {
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookDelivery,
  WebhookEvent,
  WebhookPayloadBase,
  WebhookDeliveryStatus,
} from "../shared/types.js";
import { InvoqSignatureError, InvoqError } from "../shared/error";

// ─────────────────────────────────────────────────────────────────────────────

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Register a webhook endpoint to receive billing event notifications.
   * The returned `signingSecret` is shown ONCE — store it securely.
   *
   * @param url - HTTPS URL that will receive POST requests
   * @param events - Event types to subscribe to. Empty array = all events.
   *
   * @example
   * const endpoint = await invoq.webhooks.create(
   *   "https://yourapp.com/webhooks/invoq",
   *   ["payment.renewed", "payment.failed", "subscription.cancelled"],
   * );
   * // Store endpoint.signingSecret in your secrets manager
   */
  async create(
    url: string,
    events: WebhookEvent[] = [],
  ): Promise<WebhookEndpointWithSecret> {
    if (!url || !url.startsWith("https://")) {
      throw new InvoqError({
        message: `Webhook URL must be an HTTPS URL, got: "${url}"`,
        code: "VALIDATION_ERROR",
      });
    }

    return this.http.post<WebhookEndpointWithSecret>("/v1/webhooks", {
      url,
      events,
    });
  }

  /**
   * List all registered webhook endpoints for your developer account.
   * Note: signing secrets are NOT returned in list results.
   */
  async list(): Promise<WebhookEndpoint[]> {
    return this.http.get<WebhookEndpoint[]>("/v1/webhooks");
  }

  /**
   * Delete a webhook endpoint by ID.
   * Pending deliveries to this endpoint are abandoned.
   */
  async delete(endpointId: string): Promise<{ deleted: boolean }> {
    if (!endpointId) {
      throw new InvoqError({
        message: "endpointId is required",
        code: "VALIDATION_ERROR",
      });
    }
    return this.http.del<{ deleted: boolean }>(`/v1/webhooks/${endpointId}`);
  }

  /**
   * Fetch delivery log for your account.
   * Useful for debugging failed deliveries.
   *
   * @param opts.limit - Max records (1–200). Default: 50.
   * @param opts.status - Filter by delivery status.
   *
   * @example
   * const failed = await invoq.webhooks.log({ status: "failed", limit: 20 });
   */
  async log(opts?: {
    limit?: number;
    status?: WebhookDeliveryStatus;
  }): Promise<WebhookDelivery[]> {
    return this.http.get<WebhookDelivery[]>("/v1/webhooks/log", {
      limit:  opts?.limit,
      status: opts?.status,
    });
  }

  /**
   * Verify and parse an incoming webhook payload.
   * Call this in your webhook handler before processing any event.
   *
   * Compares the `X-Invoq-Signature` header against an HMAC-SHA256
   * of the raw request body using your signing secret.
   *
   * IMPORTANT: pass the RAW request body (Buffer or string), NOT a parsed object.
   * Many frameworks parse JSON before your handler — configure raw body access.
   *
   * @param rawBody     - Raw request body (string or Buffer)
   * @param signature   - Value of the `X-Invoq-Signature` header
   * @param secret      - Your endpoint's signing secret
   * @returns Parsed webhook payload
   * @throws InvoqSignatureError if HMAC does not match
   *
   * @example
   * // Express example
   * app.post("/webhooks/invoq", express.raw({ type: "application/json" }), (req, res) => {
   *   let event: WebhookPayloadBase;
   *   try {
   *     event = InvoqServer.webhooks.constructEvent(
   *       req.body,
   *       req.headers["x-invoq-signature"] as string,
   *       process.env.INVOQ_WEBHOOK_SECRET!,
   *     );
   *   } catch (err) {
   *     return res.status(400).send("Webhook signature invalid");
   *   }
   *
   *   switch (event.event) {
   *     case "payment.renewed":
   *       // handle renewal
   *       break;
   *     case "payment.failed":
   *       // handle failure — notify user, pause access
   *       break;
   *   }
   *   res.status(200).end();
   * });
   */
  constructEvent(
    rawBody: string | Buffer,
    signature: string,
    secret: string,
  ): WebhookPayloadBase {
    if (!signature) {
      throw new InvoqSignatureError("X-Invoq-Signature header is missing");
    }
    if (!secret) {
      throw new InvoqSignatureError("Signing secret must not be empty");
    }

    // Strip "sha256=" prefix if present
    const sigHex = signature.startsWith("sha256=")
      ? signature.slice(7)
      : signature;

    const bodyStr =
      typeof rawBody === "string"
        ? rawBody
        : rawBody.toString("utf8");

    const expectedSig = this.hmacSha256Hex(bodyStr, secret);

    if (!timingSafeEqual(sigHex, expectedSig)) {
      throw new InvoqSignatureError(
        "Webhook signature mismatch. Ensure you are passing the raw request body, not a parsed object.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      throw new InvoqError({
        message: "Webhook body is not valid JSON",
        code: "PARSE_ERROR",
      });
    }

    return parsed as WebhookPayloadBase;
  }

  // ── HMAC helpers ──────────────────────────────────────────────────────────

  /**
   * Compute HMAC-SHA256 hex.
   * Works in both Node.js (crypto module) and browsers (SubtleCrypto).
   * The constructor picks the right impl at call time.
   */
  private hmacSha256Hex(body: string, secret: string): string {
    // Node.js path (fastest, synchronous)
    // Using dynamic require so this doesn't break in browsers
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHmac } = require("crypto") as typeof import("crypto");
      return createHmac("sha256", secret).update(body).digest("hex");
    } catch {
      throw new InvoqError({
        message:
          "HMAC computation failed. In browser environments use constructEventAsync() instead.",
        code: "UNKNOWN_ERROR",
      });
    }
  }

  /**
   * Async HMAC-SHA256 using SubtleCrypto — works in both browsers and modern runtimes.
   * Use this instead of constructEvent() in edge/browser environments.
   *
   * @example
   * const event = await invoq.webhooks.constructEventAsync(rawBody, sig, secret);
   */
  async constructEventAsync(
    rawBody: string | Buffer,
    signature: string,
    secret: string,
  ): Promise<WebhookPayloadBase> {
    if (!signature) {
      throw new InvoqSignatureError("X-Invoq-Signature header is missing");
    }
    if (!secret) {
      throw new InvoqSignatureError("Signing secret must not be empty");
    }

    const sigHex = signature.startsWith("sha256=")
      ? signature.slice(7)
      : signature;

    const bodyStr =
      typeof rawBody === "string"
        ? rawBody
        : rawBody.toString("utf8");

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", keyMaterial, enc.encode(bodyStr));
    const expectedSig = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (!timingSafeEqual(sigHex, expectedSig)) {
      throw new InvoqSignatureError(
        "Webhook signature mismatch. Ensure you are passing the raw request body.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      throw new InvoqError({
        message: "Webhook body is not valid JSON",
        code: "PARSE_ERROR",
      });
    }

    return parsed as WebhookPayloadBase;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing-safe string comparison (prevents timing attacks on HMAC comparison)
// ─────────────────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  // Try Node.js timingSafeEqual first
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { timingSafeEqual: nodeSafe } = require("crypto") as typeof import("crypto");
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length) return false;
    return nodeSafe(aBuf, bBuf);
  } catch {
    // Fallback: constant-time character comparison
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
}