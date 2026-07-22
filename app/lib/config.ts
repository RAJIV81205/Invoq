// Dashboard-side config. Mirrors invoq-api/src/config.ts and exposes the
// API base URL the BFF forwards to.

export const SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS =
  "CC5FVK42PNUGPQZRYDYW7EVRIQIW2GTNPF6TVMZBBVPCLLDMJZLKU3PF";

export const BILLING_CYCLE_CONTRACT_ADDRESS =
  "CAR6HPIXMNI4B4GONOWCXLN2N7VHH45FEX7IM2JDARR7XZHETNVDUUOR";

export const SPEND_POLICY_CONTRACT_ADDRESS =
  "CDTLW43XT55X5FZB3PPC5Y7UG6PSYC4LW3ZED23YIEIVDXVOT72QHFPG";

export const ESCROW_VAULT_CONTRACT_ADDRESS =
  "CBANJOGMJZ3CAIHX45UWUTDUVXZIMUYOZPXNHYZLKKHZBQ5ZAR6L2LLO";

export const USDC_SAC =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

// In the browser we use NEXT_PUBLIC_INVOQ_API_URL; on the server (BFF) we
// can fall back to INVOQ_API_URL or a default.
export const API_BASE_URL =
  (typeof window === "undefined"
    ? process.env.INVOQ_API_URL?.trim() ||
      process.env.NEXT_PUBLIC_INVOQ_API_URL?.trim()
    : process.env.NEXT_PUBLIC_INVOQ_API_URL)
    ?.trim()
    .replace(/\/$/, "") || "http://localhost:3001";
