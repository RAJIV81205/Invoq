import { scValToNative } from "@stellar/stellar-sdk";
import {
  BILLING_CYCLE_CONTRACT_ADDRESS,
  ESCROW_VAULT_CONTRACT_ADDRESS,
} from "../config.js";
import {
  countDevelopers,
  getPlatformStatsLastProcessedLedger,
  getTotalPlatformUsdcFlowStroops,
  recordPlatformPaymentEvents,
  type PlatformPaymentEventInput,
} from "../lib/db/index.js";
import { getRpc } from "../lib/stellar/client.js";
import { getPlanCount } from "../lib/stellar/registry.js";

const EVENT_PAGE_SIZE = 1_000;
const EVENT_LEDGER_WINDOW = 9_000;
const RPC_INDEX_MARGIN = 25;
const BILLING_PAYMENT_EVENTS = new Set(["subscription_initiated", "renewal_succeeded"]);
const VAULT_PAYMENT_EVENTS = new Set(["vault_debited"]);

let activeSync: Promise<void> | null = null;

function readAmount(value: unknown, field: string): bigint | null {
  if (!value || typeof value !== "object") return null;
  const amount = (value as Record<string, unknown>)[field];
  if (typeof amount !== "bigint" && typeof amount !== "number" && typeof amount !== "string") return null;

  try {
    const parsed = BigInt(amount);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parsePaymentEvent(event: Awaited<ReturnType<ReturnType<typeof getRpc>["getEvents"]>>["events"][number]): PlatformPaymentEventInput | null {
  if (!event.inSuccessfulContractCall || event.topic.length === 0 || !event.contractId) return null;

  const eventType = scValToNative(event.topic[0]!);
  if (typeof eventType !== "string") return null;

  const contractId = event.contractId.contractId();
  const value = scValToNative(event.value) as unknown;
  const amountStroops =
    contractId === BILLING_CYCLE_CONTRACT_ADDRESS && BILLING_PAYMENT_EVENTS.has(eventType)
      ? readAmount(value, "amount_usdc")
      : contractId === ESCROW_VAULT_CONTRACT_ADDRESS && VAULT_PAYMENT_EVENTS.has(eventType)
        ? readAmount(value, "amount")
        : null;

  if (amountStroops === null) return null;

  return {
    id: event.id,
    contractId,
    eventType,
    amountStroops,
    ledger: event.ledger,
    txHash: event.txHash,
    ledgerClosedAt: new Date(event.ledgerClosedAt),
  };
}

async function runPaymentEventSync(): Promise<void> {
  const contractIds = [BILLING_CYCLE_CONTRACT_ADDRESS, ESCROW_VAULT_CONTRACT_ADDRESS]
    .filter((id): id is string => Boolean(id));
  if (contractIds.length !== 2) throw new Error("Billing and vault contract addresses are required for platform stats");

  const rpc = getRpc();
  const health = await rpc.getHealth();
  // Public RPC nodes can sit a few ledgers apart behind a load balancer.
  // Keep margin inside advertised retention window on both boundaries.
  const retentionFloor = health.oldestLedger + RPC_INDEX_MARGIN;
  const targetLedger = health.latestLedger - RPC_INDEX_MARGIN;
  const filters = [{ type: "contract" as const, contractIds }];

  const checkpoint = await getPlatformStatsLastProcessedLedger();
  const startLedger = Math.max((checkpoint ?? retentionFloor - 1) + 1, retentionFloor);

  if (startLedger > targetLedger) return;

  const events: PlatformPaymentEventInput[] = [];

  // RPC providers cap practical event ranges. Scan bounded ledger windows;
  // event IDs remain unique in Mongo, making retries safe and idempotent.
  for (let windowStart = startLedger; windowStart <= targetLedger; windowStart += EVENT_LEDGER_WINDOW) {
    const windowEnd = Math.min(windowStart + EVENT_LEDGER_WINDOW - 1, targetLedger);
    let response = await rpc.getEvents({
      startLedger: windowStart,
      endLedger: windowEnd,
      filters,
      limit: EVENT_PAGE_SIZE,
    });

    while (true) {
      for (const event of response.events) {
        const parsed = parsePaymentEvent(event);
        if (parsed) events.push(parsed);
      }

      if (response.events.length < EVENT_PAGE_SIZE) break;
      response = await rpc.getEvents({
        cursor: response.cursor,
        filters,
        limit: EVENT_PAGE_SIZE,
      });
    }
  }

  await recordPlatformPaymentEvents(events, targetLedger);
}

async function syncPaymentEvents(): Promise<void> {
  if (!activeSync) {
    activeSync = runPaymentEventSync().finally(() => {
      activeSync = null;
    });
  }
  await activeSync;
}

function formatUsdc(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const fraction = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  const wholeFormatted = whole.toLocaleString("en-US");
  return fraction ? `${wholeFormatted}.${fraction}` : wholeFormatted;
}

export async function getPublicPlatformStats() {
  await syncPaymentEvents();

  const [developersOnboarded, plansCreated, usdcFlowStroops] = await Promise.all([
    countDevelopers(),
    getPlanCount(),
    getTotalPlatformUsdcFlowStroops(),
  ]);

  return {
    developersOnboarded,
    plansCreated: plansCreated.toString(),
    usdcFlowStroops: usdcFlowStroops.toString(),
    usdcFlow: formatUsdc(usdcFlowStroops),
    network: process.env.STELLAR_NETWORK ?? "testnet",
    updatedAt: new Date().toISOString(),
  };
}
