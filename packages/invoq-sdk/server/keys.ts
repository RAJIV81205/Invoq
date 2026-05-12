import type { HttpClient } from "../shared/http.js";
import type {
  ApiKeyInfo,
  CreatePublishableKeyParams,
  CreatePublishableKeyResult,
  CreateSecretKeyResult,
} from "../shared/types.js";

export class KeysResource {
  constructor(private readonly http: HttpClient) {}

  /** List all API keys for the authenticated developer account. */
  async list(): Promise<ApiKeyInfo[]> {
    return this.http.get<ApiKeyInfo[]>("/v1/keys");
  }

  /** Create a new publishable key (pk_live_... / pk_test_...). */
  async createPublishable(
    params: CreatePublishableKeyParams = {},
  ): Promise<CreatePublishableKeyResult> {
    const expiresAt =
      params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt;

    return this.http.post<CreatePublishableKeyResult>("/v1/keys/publishable", {
      name: params.name,
      expiresAt,
    });
  }

  /** Create a new secret server key (sk_live_... / sk_test_...) in same env. */
  async createSecret(
    params: CreatePublishableKeyParams = {},
  ): Promise<CreateSecretKeyResult> {
    const expiresAt =
      params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt;

    return this.http.post<CreateSecretKeyResult>("/v1/keys/secret", {
      name: params.name,
      expiresAt,
    });
  }

  /** Revoke an API key by ID. This action is irreversible. */
  async revoke(keyId: string): Promise<{ revoked: boolean; keyId: string }> {
    return this.http.del<{ revoked: boolean; keyId: string }>(`/v1/keys/${keyId}`);
  }
}
