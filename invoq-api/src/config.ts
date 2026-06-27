/**
 * src/config.ts
 *
 * Centralised contract addresses. Reads from env vars with sensible fallbacks
 * for the deployed testnet. The dashboard's lib/config.ts mirrors these.
 *
 * IMPORTANT: SPEND_POLICY_CONTRACT_ADDRESS is the address of the deployed
 * SpendPolicy contract on the target network. If the env var is missing the
 * /v1/spend-policies routes will refuse to start.
 */

export const SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS =
  process.env.SUBSCRIPTION_REGISTRY_CONTRACT_ADDRESS ?? "";

export const BILLING_CYCLE_CONTRACT_ADDRESS =
  process.env.BILLING_CYCLE_CONTRACT_ADDRESS ?? process.env.BILLING_CONTRACT_ID ?? "";

export const SPEND_POLICY_CONTRACT_ADDRESS =
  process.env.SPEND_POLICY_CONTRACT_ADDRESS ?? "";

export const ESCROW_VAULT_CONTRACT_ADDRESS =
  process.env.ESCROW_VAULT_CONTRACT_ADDRESS ?? process.env.ESCROW_VAULT_CONTRACT_ID ?? "";

export const USDC_SAC_ADDRESS =
  process.env.USDC_SAC_ADDRESS ?? "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
