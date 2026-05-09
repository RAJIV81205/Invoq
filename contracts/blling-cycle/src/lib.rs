#![no_std]

//! # BillingCycle
//!
//! The renewal automation engine for Invoq.
//!
//! ## Responsibilities
//! - Accept initial subscription payment and call SubscriptionRegistry
//! - Process batch renewal payments for due subscriptions
//! - Handle grace periods for failed payments
//! - Expire subscriptions whose grace windows have closed
//! - Route USDC via Stellar Asset Contract (SAC)
//!
//! ## Access Control
//! - `initialize`          — once only, no auth
//! - `initiate_subscription` — the customer themselves (they must sign)
//! - `process_renewals`    — admin only (Invoq backend cron)
//! - `retry_payment`       — admin only
//! - `expire_grace_periods`— admin only
//! - `set_grace_period`    — admin only
//! - `transfer_admin`      — admin only
//! - All `get_*`           — public
//!
//! ## Integration with SubscriptionRegistry
//! BillingCycle is granted "operator" status on SubscriptionRegistry during
//! deployment. This lets it call admin-only Registry functions
//! (create_subscription, update_status, renew_subscription) autonomously.
//!
//! ## USDC Flow
//! All USDC moves through the Stellar USDC Stellar Asset Contract (SAC).
//! Customers must call `USDC_SAC.approve(billing_cycle_address, amount, expiry)`
//! before calling `initiate_subscription`. The frontend SDK handles this.
//! BillingCycle holds NO funds — it only routes transfers.

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractevent,
    Address, Env, Vec, Symbol, IntoVal,
    panic_with_error, log,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const LEDGERS_PER_YEAR: u32   = 6_307_200;
const PERSISTENT_TTL_THRESHOLD: u32 = LEDGERS_PER_YEAR;
const PERSISTENT_TTL_BUMP:      u32 = LEDGERS_PER_YEAR;

/// Maximum customers per process_renewals or expire_grace_periods call.
/// Tuned to stay within Soroban's instruction limit with cross-contract calls.
const MAX_BATCH_SIZE: u32 = 30;

/// Default grace period: 3 days in seconds
const DEFAULT_GRACE_SECONDS: u64 = 259_200;

/// Minimum grace period: 1 hour
const MIN_GRACE_SECONDS: u64 = 3_600;

// ─── Error Codes ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // Initialisation
    AlreadyInitialized     = 1,
    NotInitialized         = 2,

    // Auth
    Unauthorized           = 10,

    // Batch
    BatchTooLarge          = 20,

    // Grace period
    InvalidGracePeriod     = 30,
    NotInGracePeriod       = 31,

    // Subscription state
    SubscriptionNotFound   = 40,
    AlreadySubscribed      = 41,
    PlanNotActive          = 42,
    InsufficientAllowance  = 43,
    PaymentFailed          = 44,
    InvalidPeriod          = 45,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address — instance storage
    Admin,
    /// SubscriptionRegistry contract address — instance storage, immutable
    RegistryId,
    /// USDC SAC address — instance storage, immutable
    UsdcSac,
    /// Grace period duration in seconds — instance storage
    GracePeriodSeconds,
    /// GraceRecord keyed by customer — persistent storage
    /// Written when a subscription enters GracePeriod; removed on recovery or expiry.
    GraceRecord(Address),
}

// ─── Data Structures ─────────────────────────────────────────────────────────

/// Tracks when a customer entered grace period so expiry can be computed.
#[contracttype]
#[derive(Clone)]
pub struct GraceRecord {
    /// The customer whose subscription is in GracePeriod.
    pub customer: Address,
    /// Unix timestamp when the original renewal was due (period end).
    /// Grace period expires at `grace_started_at + grace_period_seconds`.
    pub grace_started_at: u64,
    /// The billing amount that failed, in USDC stroops.
    /// Used for retry attempts.
    pub amount_usdc: i128,
    /// The plan owner address — USDC goes to them on successful retry.
    pub plan_owner: Address,
    /// The new period start timestamp (= original period end).
    /// Preserved so retry uses original dates, not retry date.
    pub new_period_start: u64,
    /// The new period end timestamp.
    pub new_period_end: u64,
}

/// Summary returned by process_renewals for monitoring.
#[contracttype]
#[derive(Clone)]
pub struct RenewalSummary {
    /// Count of subscriptions successfully renewed.
    pub renewed: u32,
    /// Count of subscriptions that failed payment and entered GracePeriod.
    pub grace_entered: u32,
    /// Count of subscriptions already in GracePeriod where retry also failed.
    pub grace_retry_failed: u32,
    /// Count of entries skipped (not yet due, already cancelled, etc.).
    pub skipped: u32,
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct SubscriptionInitiated {
    #[topic] pub customer: Address,
    #[topic] pub plan_id:  u64,
    pub amount_usdc: i128,
    pub period_end: u64,
}

#[contractevent]
pub struct RenewalSucceeded {
    #[topic] pub customer:    Address,
    #[topic] pub plan_id:     u64,
    pub amount_usdc: i128,
    pub new_period_end: u64,
}

#[contractevent]
pub struct RenewalFailed {
    #[topic] pub customer: Address,
    pub amount_usdc: i128,
    pub grace_expires_at: u64,
}

#[contractevent]
pub struct GracePeriodExpired {
    #[topic] pub customer: Address,
    pub expired_at: u64,
}

#[contractevent]
pub struct PaymentRetried {
    #[topic] pub customer: Address,
    pub success: bool,
}

#[contractevent]
pub struct GracePeriodUpdated {
    pub old_seconds: u64,
    pub new_seconds: u64,
}

// ─── Registry Cross-Contract Interface ───────────────────────────────────────
//
// BillingCycle calls SubscriptionRegistry via cross-contract calls.
// We declare only the subset of the Registry interface that BillingCycle needs.
// The full Registry ABI is in subscription_registry/src/lib.rs.
//
// Import the Registry client:
//   In Cargo.toml, add:
//     [dependencies]
//     subscription-registry = { path = "../subscription_registry", features = ["library"] }
//
// Then use: use subscription_registry::SubscriptionRegistryClient;
//
// For this standalone file we declare a minimal interface via soroban_sdk's
// contractclient macro. In a real workspace you'd import the generated client.

mod registry {
    use soroban_sdk::{contracttype, Address, String, Vec};

    // Mirror the SubStatus enum from SubscriptionRegistry for cross-contract use.
    // Must match exactly — XDR encoding is by variant index.
    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum SubStatus {
        Trialing,
        Active,
        Paused,
        GracePeriod,
        Cancelled,
        Expired,
    }

    // Mirror SubscriptionRecord for reading renewal data
    #[contracttype]
    #[derive(Clone)]
    pub struct SubscriptionRecord {
        pub customer:             Address,
        pub plan_id:              u64,
        pub status:               SubStatus,
        pub started_at:           u64,
        pub current_period_start: u64,
        pub current_period_end:   u64,
        pub trial_end:            u64,
        pub cancel_at_period_end: bool,
        pub usage_current:        u64,
    }

    // Mirror PlanConfig for reading plan price and interval
    #[contracttype]
    #[derive(Clone)]
    pub struct PlanConfig {
        pub plan_id:          u64,
        pub name:             String,
        pub price_usdc:       i128,
        pub interval_seconds: u64,
        pub trial_seconds:    u64,
        pub usage_limit:      u64,
        pub features:         Vec<String>,
        pub active:           bool,
        pub owner:            Address,
        pub created_at:       u64,
    }
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn require_admin(env: &Env) {
    load_admin(env).require_auth();
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

fn load_registry_id(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::RegistryId)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_usdc_sac(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::UsdcSac)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn load_grace_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::GracePeriodSeconds)
        .unwrap_or(DEFAULT_GRACE_SECONDS)
}

fn store_grace_record(env: &Env, record: &GraceRecord) {
    let key = DataKey::GraceRecord(record.customer.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

fn load_grace_record(env: &Env, customer: &Address) -> Option<GraceRecord> {
    let key = DataKey::GraceRecord(customer.clone());
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, GraceRecord>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }
    result
}

fn remove_grace_record(env: &Env, customer: &Address) {
    let key = DataKey::GraceRecord(customer.clone());
    env.storage().persistent().remove(&key);
}

// ─── Registry Cross-Contract Helpers ─────────────────────────────────────────
//
// Cross-contract calls use Symbol::new(env, "fn_name") — NOT symbol_short!.
// symbol_short! has a hard 9-character compile-time limit and is only for
// short storage keys / event topics. Function names like "get_subscription"
// (16 chars) and "create_subscription" (19 chars) must use Symbol::new.
//
// All arguments use .into_val(env) which requires `IntoVal` to be in scope.

fn registry_get_subscription(
    env: &Env,
    registry: &Address,
    customer: &Address,
) -> Option<registry::SubscriptionRecord> {
    env.invoke_contract(
        registry,
        &Symbol::new(env, "get_subscription"),
        soroban_sdk::vec![env, customer.into_val(env)],
    )
}

fn registry_get_plan(
    env: &Env,
    registry: &Address,
    plan_id: u64,
) -> Option<registry::PlanConfig> {
    env.invoke_contract(
        registry,
        &Symbol::new(env, "get_plan"),
        soroban_sdk::vec![env, plan_id.into_val(env)],
    )
}

fn registry_create_subscription(
    env: &Env,
    registry: &Address,
    customer: &Address,
    plan_id: u64,
) {
    let _: registry::SubscriptionRecord = env.invoke_contract(
        registry,
        &Symbol::new(env, "create_subscription"),
        soroban_sdk::vec![
            env,
            env.current_contract_address().into_val(env), // caller = BillingCycle (operator)
            customer.into_val(env),
            plan_id.into_val(env),
        ],
    );
}

fn registry_update_status(
    env: &Env,
    registry: &Address,
    customer: &Address,
    status: registry::SubStatus,
) {
    let _: () = env.invoke_contract(
        registry,
        &Symbol::new(env, "update_status"),
        soroban_sdk::vec![
            env,
            env.current_contract_address().into_val(env), // caller = BillingCycle (operator)
            customer.into_val(env),
            status.into_val(env),
        ],
    );
}

fn registry_renew_subscription(
    env: &Env,
    registry: &Address,
    customer: &Address,
    new_period_start: u64,
    new_period_end: u64,
) {
    let _: () = env.invoke_contract(
        registry,
        &Symbol::new(env, "renew_subscription"),
        soroban_sdk::vec![
            env,
            env.current_contract_address().into_val(env), // caller = BillingCycle (operator)
            customer.into_val(env),
            new_period_start.into_val(env),
            new_period_end.into_val(env),
        ],
    );
}

// ─── Payment Helper ───────────────────────────────────────────────────────────

/// Attempts a USDC SAC `transfer_from` from `from` to `to` for `amount` stroops.
///
/// Returns `true` if the transfer succeeded, `false` on any failure
/// (insufficient balance, insufficient allowance, SAC panic, etc.).
///
/// `env.try_invoke_contract` returns `Result<Result<T, soroban_sdk::Error>, InvokeError>`
/// — a double-wrapped Result. Both layers must be Ok for the call to have succeeded.
/// We use `matches!(result, Ok(Ok(_)))` to check both in one expression.
fn try_transfer_usdc(
    env: &Env,
    usdc_sac: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> bool {
    if amount == 0 {
        return true; // Free plan — no transfer needed
    }

    // transfer_from: debit `from`'s allowance pre-approved to this contract,
    // send `amount` to `to`. The customer must have called
    // USDC_SAC.approve(billing_cycle_address, amount, expiry) beforehand.
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        usdc_sac,
        &Symbol::new(env, "transfer_from"),
        soroban_sdk::vec![
            env,
            env.current_contract_address().into_val(env), // spender
            from.into_val(env),                           // from
            to.into_val(env),                             // to
            amount.into_val(env),                         // amount
        ],
    );

    // try_invoke_contract returns Result<Result<T, soroban_sdk::Error>, InvokeError>.
    // Payment succeeded only when BOTH layers are Ok.
    matches!(result, Ok(Ok(_)))
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BillingCycle;

#[contractimpl]
impl BillingCycle {

    // ═════════════════════════════════════════════════════════════════════════
    // INITIALISATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Initialises BillingCycle. Must be called once immediately after deployment.
    ///
    /// After calling this, call `SubscriptionRegistry.set_operator(billing_cycle_address)`
    /// so this contract has authority to call Registry write functions.
    ///
    /// # Arguments
    /// * `admin`                — Admin wallet or multisig.
    /// * `registry_id`          — Deployed SubscriptionRegistry contract address.
    /// * `usdc_sac`             — Stellar USDC SAC address (immutable after init).
    /// * `grace_period_seconds` — Default grace period. Min 3600 (1h). Recommend 259200 (3d).
    pub fn initialize(
        env: Env,
        admin: Address,
        registry_id: Address,
        usdc_sac: Address,
        grace_period_seconds: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if grace_period_seconds < MIN_GRACE_SECONDS {
            panic_with_error!(&env, Error::InvalidGracePeriod);
        }

        env.storage().instance().set(&DataKey::Admin,              &admin);
        env.storage().instance().set(&DataKey::RegistryId,         &registry_id);
        env.storage().instance().set(&DataKey::UsdcSac,            &usdc_sac);
        env.storage().instance().set(&DataKey::GracePeriodSeconds,  &grace_period_seconds);

        log!(&env, "BillingCycle initialized. registry={}", registry_id);
    }

    /// Transfers admin authority to a new address.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    /// Returns the current grace period in seconds.
    pub fn get_grace_period(env: Env) -> u64 {
        load_grace_seconds(&env)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SUBSCRIPTION INITIATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Entry point for a new customer subscription.
    ///
    /// The CUSTOMER must be the invoker — this prevents subscriptions being
    /// created on someone's behalf without their explicit authorisation.
    ///
    /// Flow:
    /// 1. Customer must have pre-approved USDC SAC allowance for this contract.
    ///    Allowance >= plan.price_usdc * 13 (1 year of monthly payments).
    /// 2. BillingCycle reads the plan price from Registry.
    /// 3. If plan has a trial: no initial charge; subscription starts in Trialing.
    /// 4. If no trial: charge plan.price_usdc immediately via SAC transfer_from.
    /// 5. On success: call Registry.create_subscription to write the record.
    /// 6. On payment failure: panic — no state is written.
    ///
    /// # Arguments
    /// * `customer` — The subscribing customer's wallet. Must be the invoker.
    /// * `plan_id`  — The plan ID to subscribe to.
    ///
    /// # Errors
    /// * `PaymentFailed`  — SAC transfer_from failed (no balance / allowance).
    /// * `PlanNotActive`  — Plan is deactivated.
    /// * `AlreadySubscribed` — Customer already has a non-terminal subscription.
    pub fn initiate_subscription(env: Env, customer: Address, plan_id: u64) {
        // Customer must have signed this transaction
        customer.require_auth();

        let registry = load_registry_id(&env);
        let usdc_sac = load_usdc_sac(&env);

        // Load plan from Registry to get price and owner
        let plan = match registry_get_plan(&env, &registry, plan_id) {
            Some(p) => p,
            None    => panic_with_error!(&env, Error::PlanNotActive),
        };

        if !plan.active {
            panic_with_error!(&env, Error::PlanNotActive);
        }

        // Guard: customer must not already have an active subscription.
        // The Registry also enforces this; we check early to fail fast.
        if let Some(existing) = registry_get_subscription(&env, &registry, &customer) {
            match existing.status {
                registry::SubStatus::Cancelled | registry::SubStatus::Expired => {}
                _ => panic_with_error!(&env, Error::AlreadySubscribed),
            }
        }

        // Charge initial payment (skipped for trials and free plans)
        let initial_charge = if plan.trial_seconds > 0 || plan.price_usdc == 0 {
            0i128 // Trial: no upfront charge; free: nothing to charge
        } else {
            plan.price_usdc
        };

        if initial_charge > 0 {
            let ok = try_transfer_usdc(
                &env,
                &usdc_sac,
                &customer,
                &plan.owner,
                initial_charge,
            );
            if !ok {
                panic_with_error!(&env, Error::PaymentFailed);
            }
        }

        // Compute period end for the event (Registry computes it internally too)
        let now        = env.ledger().timestamp();
        let period_end = now + plan.interval_seconds;

        // Write subscription record to Registry (BillingCycle is the operator)
        registry_create_subscription(&env, &registry, &customer, plan_id);

        SubscriptionInitiated {
            customer,
            plan_id,
            amount_usdc: initial_charge,
            period_end,
        }
        .publish(&env);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RENEWAL PROCESSING
    // ═════════════════════════════════════════════════════════════════════════

    /// Processes renewal payments for a batch of due customers.
    ///
    /// Called by the Invoq backend cron job every 60 seconds.
    /// The backend queries Registry off-chain to identify customers whose
    /// `current_period_end <= now`, then passes their addresses here.
    ///
    /// Processing rules per customer:
    /// - If `current_period_end > now`: skip (not yet due).
    /// - If status is `Cancelled` or `Expired`: skip.
    /// - If `cancel_at_period_end = true`: mark as Cancelled, skip payment.
    /// - If `status = Active` or `Trialing`: attempt USDC transfer.
    ///   - Success → call Registry.renew_subscription, advance period.
    ///   - Failure → call Registry.update_status(GracePeriod), write GraceRecord.
    /// - If `status = GracePeriod`: retry payment.
    ///   - Success → call Registry.renew_subscription, remove GraceRecord.
    ///   - Failure → leave in GracePeriod (expire_grace_periods handles expiry).
    ///
    /// Each customer is processed independently — a failure does not roll back
    /// successful renewals in the same batch.
    ///
    /// # Arguments
    /// * `customers` — Addresses to process. Max 30 per call.
    ///
    /// # Returns
    /// `RenewalSummary` with counts for monitoring and alerting.
    pub fn process_renewals(env: Env, customers: Vec<Address>) -> RenewalSummary {
        require_admin(&env);

        if customers.len() > MAX_BATCH_SIZE {
            panic_with_error!(&env, Error::BatchTooLarge);
        }

        let registry      = load_registry_id(&env);
        let usdc_sac      = load_usdc_sac(&env);
        let grace_seconds = load_grace_seconds(&env);
        let now           = env.ledger().timestamp();

        let mut renewed:           u32 = 0;
        let mut grace_entered:     u32 = 0;
        let mut grace_retry_failed:u32 = 0;
        let mut skipped:           u32 = 0;

        for i in 0..customers.len() {
            let customer = customers.get(i).unwrap();

            let sub = match registry_get_subscription(&env, &registry, &customer) {
                Some(s) => s,
                None    => { skipped += 1; continue; }
            };

            // Skip terminal states
            match sub.status {
                registry::SubStatus::Cancelled | registry::SubStatus::Expired => {
                    skipped += 1;
                    continue;
                }
                registry::SubStatus::Paused => {
                    skipped += 1;
                    continue;
                }
                _ => {}
            }

            // Not yet due — skip
            if sub.current_period_end > now {
                skipped += 1;
                continue;
            }

            // Scheduled cancellation — close subscription, no payment
            if sub.cancel_at_period_end {
                registry_update_status(
                    &env,
                    &registry,
                    &customer,
                    registry::SubStatus::Cancelled,
                );
                skipped += 1;
                continue;
            }

            // Load plan for price and owner
            let plan = match registry_get_plan(&env, &registry, sub.plan_id) {
                Some(p) => p,
                None    => { skipped += 1; continue; } // Plan deleted — skip
            };

            let new_period_start = sub.current_period_end;
            let new_period_end   = sub.current_period_end + plan.interval_seconds;

            match sub.status {
                registry::SubStatus::Active | registry::SubStatus::Trialing => {
                    // First renewal attempt
                    let ok = try_transfer_usdc(
                        &env,
                        &usdc_sac,
                        &customer,
                        &plan.owner,
                        plan.price_usdc,
                    );

                    if ok {
                        registry_renew_subscription(
                            &env,
                            &registry,
                            &customer,
                            new_period_start,
                            new_period_end,
                        );
                        RenewalSucceeded {
                            customer:      customer.clone(),
                            plan_id:       sub.plan_id,
                            amount_usdc:   plan.price_usdc,
                            new_period_end,
                        }
                        .publish(&env);
                        renewed += 1;
                    } else {
                        // Payment failed — enter grace period
                        let grace_expires_at = now + grace_seconds;

                        registry_update_status(
                            &env,
                            &registry,
                            &customer,
                            registry::SubStatus::GracePeriod,
                        );

                        store_grace_record(&env, &GraceRecord {
                            customer:         customer.clone(),
                            grace_started_at: now,
                            amount_usdc:      plan.price_usdc,
                            plan_owner:       plan.owner.clone(),
                            new_period_start,
                            new_period_end,
                        });

                        RenewalFailed {
                            customer:        customer.clone(),
                            amount_usdc:     plan.price_usdc,
                            grace_expires_at,
                        }
                        .publish(&env);
                        grace_entered += 1;
                    }
                }

                registry::SubStatus::GracePeriod => {
                    // Retry payment for a subscription already in grace period
                    let grace_record = match load_grace_record(&env, &customer) {
                        Some(r) => r,
                        None    => { skipped += 1; continue; }
                    };

                    let ok = try_transfer_usdc(
                        &env,
                        &usdc_sac,
                        &customer,
                        &grace_record.plan_owner,
                        grace_record.amount_usdc,
                    );

                    if ok {
                        // Recover from grace period — use original period dates
                        registry_renew_subscription(
                            &env,
                            &registry,
                            &customer,
                            grace_record.new_period_start,
                            grace_record.new_period_end,
                        );
                        remove_grace_record(&env, &customer);

                        RenewalSucceeded {
                            customer:      customer.clone(),
                            plan_id:       sub.plan_id,
                            amount_usdc:   grace_record.amount_usdc,
                            new_period_end: grace_record.new_period_end,
                        }
                        .publish(&env);
                        renewed += 1;

                        PaymentRetried {
                            customer: customer.clone(),
                            success: true,
                        }
                        .publish(&env);
                    } else {
                        // Still failing — remain in GracePeriod
                        // expire_grace_periods will handle expiry
                        grace_retry_failed += 1;

                        PaymentRetried {
                            customer: customer.clone(),
                            success: false,
                        }
                        .publish(&env);
                    }
                }

                _ => { skipped += 1; }
            }
        }

        RenewalSummary {
            renewed,
            grace_entered,
            grace_retry_failed,
            skipped,
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GRACE PERIOD MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    /// Expires subscriptions whose grace periods have elapsed.
    ///
    /// Called by a separate, lower-frequency cron job (e.g. every 15 minutes).
    /// The backend supplies a list of customers currently in GracePeriod.
    ///
    /// For each customer, checks if `grace_started_at + grace_seconds <= now`.
    /// If so: calls Registry.update_status(Cancelled) and removes the GraceRecord.
    ///
    /// # Arguments
    /// * `customers` — Customers in GracePeriod to check. Max 50.
    ///
    /// # Returns
    /// Count of subscriptions expired in this call.
    pub fn expire_grace_periods(env: Env, customers: Vec<Address>) -> u32 {
        require_admin(&env);

        if customers.len() > 50 {
            panic_with_error!(&env, Error::BatchTooLarge);
        }

        let registry      = load_registry_id(&env);
        let grace_seconds = load_grace_seconds(&env);
        let now           = env.ledger().timestamp();
        let mut expired   = 0u32;

        for i in 0..customers.len() {
            let customer = customers.get(i).unwrap();

            let grace_record = match load_grace_record(&env, &customer) {
                Some(r) => r,
                None    => continue, // No grace record — skip
            };

            let grace_expires_at = grace_record.grace_started_at + grace_seconds;

            if now >= grace_expires_at {
                // Grace window closed — cancel subscription
                registry_update_status(
                    &env,
                    &registry,
                    &customer,
                    registry::SubStatus::Cancelled,
                );
                remove_grace_record(&env, &customer);

                GracePeriodExpired {
                    customer:   customer.clone(),
                    expired_at: now,
                }
                .publish(&env);

                expired += 1;
            }
            // If grace has not yet elapsed, leave in GracePeriod
        }

        expired
    }

    /// Manually retries payment for a single customer in GracePeriod.
    ///
    /// Used by the admin / support flow when a customer has topped up their
    /// USDC balance and wants an immediate retry rather than waiting for the
    /// next cron cycle.
    ///
    /// On success: recovers subscription to Active using original period dates.
    /// On failure: leaves in GracePeriod (no status change).
    ///
    /// # Returns
    /// true if payment succeeded, false if still failing.
    pub fn retry_payment(env: Env, customer: Address) -> bool {
        require_admin(&env);

        let grace_record = match load_grace_record(&env, &customer) {
            Some(r) => r,
            None    => panic_with_error!(&env, Error::NotInGracePeriod),
        };

        let registry = load_registry_id(&env);
        let usdc_sac = load_usdc_sac(&env);

        // Verify the subscription is actually in GracePeriod
        match registry_get_subscription(&env, &registry, &customer) {
            Some(sub) if matches!(sub.status, registry::SubStatus::GracePeriod) => {}
            _ => panic_with_error!(&env, Error::NotInGracePeriod),
        }

        let ok = try_transfer_usdc(
            &env,
            &usdc_sac,
            &customer,
            &grace_record.plan_owner,
            grace_record.amount_usdc,
        );

        if ok {
            // Recover using the original billing dates — not today's timestamp.
            // This preserves predictable renewal dates for the customer.
            registry_renew_subscription(
                &env,
                &registry,
                &customer,
                grace_record.new_period_start,
                grace_record.new_period_end,
            );
            remove_grace_record(&env, &customer);
        }

        PaymentRetried {
            customer: customer.clone(),
            success: ok,
        }
        .publish(&env);

        ok
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Updates the global grace period duration.
    ///
    /// Changes apply to future payment failures only.
    /// Subscriptions already in GracePeriod retain their original expiry.
    ///
    /// # Errors
    /// * `InvalidGracePeriod` — new value is below minimum (3600 seconds).
    pub fn set_grace_period(env: Env, new_grace_seconds: u64) {
        require_admin(&env);

        if new_grace_seconds < MIN_GRACE_SECONDS {
            panic_with_error!(&env, Error::InvalidGracePeriod);
        }

        let old = load_grace_seconds(&env);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriodSeconds, &new_grace_seconds);

        GracePeriodUpdated {
            old_seconds: old,
            new_seconds: new_grace_seconds,
        }
        .publish(&env);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // READ FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /// Returns the GraceRecord for a customer, or None.
    pub fn get_grace_record(env: Env, customer: Address) -> Option<GraceRecord> {
        load_grace_record(&env, &customer)
    }

    /// Returns the configured SubscriptionRegistry contract address.
    pub fn get_registry_id(env: Env) -> Address {
        load_registry_id(&env)
    }

    /// Returns the configured USDC SAC address.
    pub fn get_usdc_sac(env: Env) -> Address {
        load_usdc_sac(&env)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// BillingCycle tests require the SubscriptionRegistry to be deployed alongside
// and a mock USDC SAC. Full integration tests live in tests/integration.rs in
// the workspace root. Unit tests here cover internal logic that doesn't require
// live cross-contract calls.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, BillingCycleClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, BillingCycle);
        let client      = BillingCycleClient::new(&env, &contract_id);
        let admin       = Address::generate(&env);
        let registry    = Address::generate(&env); // mock address for unit tests
        let usdc_sac    = Address::generate(&env);

        client.initialize(
            &admin,
            &registry,
            &usdc_sac,
            &DEFAULT_GRACE_SECONDS,
        );

        (env, client, admin)
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_once() {
        let (env, client, admin) = setup();
        let result = client.try_initialize(
            &admin,
            &Address::generate(&env),
            &Address::generate(&env),
            &DEFAULT_GRACE_SECONDS,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_invalid_grace_period() {
        let env         = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, BillingCycle);
        let client      = BillingCycleClient::new(&env, &contract_id);

        let result = client.try_initialize(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &1800u64, // below 3600 minimum
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_get_admin() {
        let (_env, client, admin) = setup();
        assert_eq!(client.get_admin(), admin);
    }

    // ── Grace period configuration ────────────────────────────────────────────

    #[test]
    fn test_set_grace_period() {
        let (_env, client, _admin) = setup();
        client.set_grace_period(&86_400u64); // 1 day
        assert_eq!(client.get_grace_period(), 86_400u64);
    }

    #[test]
    fn test_set_grace_period_too_low_rejected() {
        let (_env, client, _admin) = setup();
        assert!(client.try_set_grace_period(&100u64).is_err());
    }

    // ── Batch size limits ─────────────────────────────────────────────────────

    #[test]
    fn test_process_renewals_batch_too_large_rejected() {
        let (env, client, _admin) = setup();

        // Build a Vec of 31 addresses (over MAX_BATCH_SIZE of 30)
        let mut addrs = soroban_sdk::vec![&env];
        for _ in 0..31 {
            addrs.push_back(Address::generate(&env));
        }

        assert!(client.try_process_renewals(&addrs).is_err());
    }

    #[test]
    fn test_expire_grace_periods_batch_too_large_rejected() {
        let (env, client, _admin) = setup();

        let mut addrs = soroban_sdk::vec![&env];
        for _ in 0..51 {
            addrs.push_back(Address::generate(&env));
        }

        assert!(client.try_expire_grace_periods(&addrs).is_err());
    }

    // ── Empty batch ───────────────────────────────────────────────────────────

    #[test]
    fn test_process_renewals_empty_batch() {
        let (env, client, _admin) = setup();
        let empty = soroban_sdk::vec![&env];
        let summary = client.process_renewals(&empty);
        assert_eq!(summary.renewed, 0u32);
        assert_eq!(summary.skipped, 0u32);
    }

    #[test]
    fn test_expire_grace_empty_batch() {
        let (env, client, _admin) = setup();
        let empty = soroban_sdk::vec![&env];
        let count = client.expire_grace_periods(&empty);
        assert_eq!(count, 0u32);
    }

    // ── Grace record ──────────────────────────────────────────────────────────

    #[test]
    fn test_get_grace_record_none_for_unknown() {
        let (env, client, _admin) = setup();
        let nobody = Address::generate(&env);
        assert!(client.get_grace_record(&nobody).is_none());
    }

    // ── retry_payment requires grace record ───────────────────────────────────

    #[test]
    fn test_retry_payment_no_grace_record_panics() {
        let (env, client, _admin) = setup();
        let nobody = Address::generate(&env);
        assert!(client.try_retry_payment(&nobody).is_err());
    }
}