export const SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS = "CC5FVK42PNUGPQZRYDYW7EVRIQIW2GTNPF6TVMZBBVPCLLDMJZLKU3PF";

export const BILLING_CYCLE_CONTRACT_ADDRESS = "CAR6HPIXMNI4B4GONOWCXLN2N7VHH45FEX7IM2JDARR7XZHETNVDUUOR";

export const SPEND_POLICY_CONTRACT_ADDRESS = "CDTLW43XT55X5FZB3PPC5Y7UG6PSYC4LW3ZED23YIEIVDXVOT72QHFPG";

export const ESCROW_VAULT_CONTRACT_ADDRESS = "CBANJOGMJZ3CAIHX45UWUTDUVXZIMUYOZPXNHYZLKKHZBQ5ZAR6L2LLO";

// In the Next.js process, NEXT_PUBLIC_* is inlined at build time.
// At runtime the dashboard's BFF handles auth — the dashboard's own
// `apiClient.ts` is only used by the manual /test page.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_INVOQ_API_URL?.trim().replace(/\/$/, "") ||
  "http://localhost:3001";

// The /test page uses this. The actual dashboard goes through the BFF.
export const API_KEY = process.env.TEST_API_KEY ?? "";
export const CUSTOMER_ADDRESS = process.env.TEST_CUSTOMER_ADDRESS ?? "";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
