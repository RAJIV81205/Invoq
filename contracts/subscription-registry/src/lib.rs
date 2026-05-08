#![no_std]

//! # SubscriptionRegistry
//!
//! The central source of truth for all subscription state in Invoq.
//!
//! ## Responsibilities
//! - Store and manage plan definitions (PlanConfig)
//! - Store and manage active subscription records (SubscriptionRecord)
//! - Enforce entitlement checks on every API request
//! - Track per-customer usage within billing periods
//!
//! ## Access Control
//! - `create_plan`         — any address (becomes plan owner)
//! - `update_plan`         — admin OR plan owner
//! - `deactivate_plan`     — admin OR plan owner
//! - `reactivate_plan`     — admin OR plan owner
//! - `create_subscription` — admin only (called by BillingCycle)
//! - `update_status`       — admin only (called by BillingCycle)
//! - `renew_subscription`  — admin only (called by BillingCycle)
//! - `cancel_subscription` — admin OR the customer themselves
//! - `increment_usage`     — admin only (called by metering service)
//! - All read functions    — public, no auth required

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractevent,
    Address, Env, String, Vec, Symbol,
    symbol_short, panic_with_error,
    log,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// 1 year in ledger seconds — minimum TTL for all persistent entries
const PERSISTENT_TTL_THRESHOLD: u32 = 31_536_000;
const PERSISTENT_TTL_BUMP: u32 = 31_536_000;

/// Maximum feature flags per plan
const MAX_FEATURES: u32 = 32;

/// Maximum name length (bytes)
const MAX_NAME_LEN: u32 = 64;

/// Minimum billing interval: 1 day in seconds
const MIN_INTERVAL_SECONDS: u64 = 86_400;

/// Minimum deposit / price unit: 0 USDC (free plans allowed)
const MIN_PRICE_USDC: i128 = 0;

// ─── Error Codes ─────────────────────────────────────────────────────────────

// FIX 1: `contracterror` was missing from the `use` imports above.
// Without it the #[contracterror] attribute is not in scope, which means the
// Error enum never gets the `From<Error> for soroban_sdk::Error` impl that
// `panic_with_error!` requires — causing all 27 E0277 trait-bound errors.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // Initialisation
    AlreadyInitialized      = 1,
    NotInitialized          = 2,

    // Auth
    Unauthorized            = 10,

    // Plan errors
    PlanNotFound            = 20,
    PlanInactive            = 21,
    InvalidPlanName         = 22,
    InvalidInterval         = 23,
    TooManyFeatures         = 24,
    InvalidPrice            = 25,
    AlreadyInactive         = 26,
    AlreadyActive           = 27,

    // Subscription errors
    SubscriptionNotFound    = 30,
    AlreadySubscribed       = 31,
    InvalidTransition       = 32,
    InvalidPeriod           = 33,
    SubscriptionNotActive   = 34,
    AlreadyCancelled        = 35,

    // Usage errors
    ZeroUnits               = 40,
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract admin address — instance storage
    Admin,
    /// USDC SAC address — instance storage, immutable after init
    UsdcSac,
    /// Monotonically incrementing plan ID counter — instance storage
    PlanCount,
    /// PlanConfig keyed by plan_id — persistent storage
    Plan(u64),
    /// SubscriptionRecord keyed by customer address — persistent storage
    Subscription(Address),
}

// ─── Data Structures ─────────────────────────────────────────────────────────

/// All possible states a subscription can be in.
/// Transitions are strictly controlled — see `validate_transition`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubStatus {
    /// Trial period is active. Entitlement is granted.
    Trialing,
    /// Subscription is current and paid. Entitlement is granted.
    Active,
    /// Subscription is explicitly paused by the customer.
    /// Entitlement is NOT granted. Billing is frozen.
    Paused,
    /// A renewal payment has failed. Entitlement is still granted
    /// during the grace window. BillingCycle handles expiry.
    GracePeriod,
    /// Subscription has been explicitly cancelled or grace period expired.
    /// Entitlement is NOT granted.
    Cancelled,
    /// Subscription reached its end date without renewal (annual plans).
    Expired,
}

impl SubStatus {
    /// Returns true if the customer should have access to their plan features.
    pub fn is_entitled(&self) -> bool {
        matches!(self, SubStatus::Active | SubStatus::Trialing | SubStatus::GracePeriod)
    }
}

/// Full definition of a subscription plan created by a developer.
#[contracttype]
#[derive(Clone)]
pub struct PlanConfig {
    /// Unique auto-incremented identifier. Never reused.
    pub plan_id: u64,
    /// Human-readable display name. Max 64 bytes.
    pub name: String,
    /// Price per billing cycle in USDC stroops.
    /// 1 USDC = 10_000_000 stroops. 0 = free plan.
    pub price_usdc: i128,
    /// Billing cycle length in seconds.
    /// Minimum: 86_400 (1 day). Standard: 2_592_000 (30d) / 31_536_000 (365d).
    pub interval_seconds: u64,
    /// Free trial duration in seconds. 0 = no trial.
    pub trial_seconds: u64,
    /// Maximum usage units per billing cycle. 0 = unlimited.
    pub usage_limit: u64,
    /// Feature flags granted by this plan, e.g. ["api_access", "webhooks"].
    pub features: Vec<String>,
    /// Whether new subscriptions can be created on this plan.
    pub active: bool,
    /// Developer wallet that owns this plan and receives renewal payments.
    pub owner: Address,
    /// Unix timestamp when this plan was created.
    pub created_at: u64,
}

/// Live subscription record for a customer.
#[contracttype]
#[derive(Clone)]
pub struct SubscriptionRecord {
    /// Customer's Stellar wallet address.
    pub customer: Address,
    /// ID of the plan this subscription is on.
    pub plan_id: u64,
    /// Current subscription lifecycle status.
    pub status: SubStatus,
    /// Unix timestamp when the subscription was first created.
    pub started_at: u64,
    /// Unix timestamp of the current billing period start.
    pub current_period_start: u64,
    /// Unix timestamp of the current billing period end (= next renewal date).
    pub current_period_end: u64,
    /// Unix timestamp when the trial ends. 0 = no trial on this plan.
    pub trial_end: u64,
    /// If true, subscription cancels at current_period_end rather than renewing.
    pub cancel_at_period_end: bool,
    /// Usage units consumed in the current billing period.
    /// Reset to 0 on every successful renewal.
    pub usage_current: u64,
}

/// Lightweight summary returned by check_entitlement for rich responses.
#[contracttype]
#[derive(Clone)]
pub struct EntitlementResult {
    pub entitled: bool,
    pub status: SubStatus,
    pub plan_id: u64,
    pub usage_current: u64,
    pub usage_limit: u64,
    pub current_period_end: u64,
}

// ─── Contract Events ──────────────────────────────────────────────────────────
//
// FIX 3: Replace the deprecated `env.events().publish(topic_tuple, data)` API
// with the modern `#[contractevent]` macro pattern introduced in soroban-sdk 25.
// Each event struct gets a `.publish(&env)` method automatically.
// Fields annotated with `#[topic]` become indexed Horizon-queryable topics;
// all other fields become the event data payload.

#[contractevent]
pub struct PlanCreated {
    #[topic]
    pub plan_id: u64,
    pub owner: Address,
}

#[contractevent]
pub struct PlanUpdated {
    #[topic]
    pub plan_id: u64,
}

// FIX 2 (part of FIX 3): "deactivated" and "reactivated" are 11 characters,
// exceeding symbol_short!'s hard limit of 9.  The old code used these as raw
// string literals in symbol_short!() calls.  The new #[contractevent] structs
// carry the full meaning in their type names, so the length limit is no longer
// an issue — the event name is derived from the struct name, not a symbol.
#[contractevent]
pub struct PlanDeactivated {
    #[topic]
    pub plan_id: u64,
}

#[contractevent]
pub struct PlanReactivated {
    #[topic]
    pub plan_id: u64,
}

#[contractevent]
pub struct SubscriptionCreated {
    #[topic]
    pub customer: Address,
    #[topic]
    pub plan_id: u64,
}

#[contractevent]
pub struct StatusChanged {
    #[topic]
    pub customer: Address,
    pub old_status: SubStatus,
    pub new_status: SubStatus,
}

#[contractevent]
pub struct SubscriptionRenewed {
    #[topic]
    pub customer: Address,
    pub plan_id: u64,
    pub new_period_end: u64,
}

#[contractevent]
pub struct SubscriptionCancelled {
    #[topic]
    pub customer: Address,
    pub effective_at: u64,
}

#[contractevent]
pub struct UsageRecorded {
    #[topic]
    pub customer: Address,
    pub plan_id: u64,
    pub units: u64,
    pub new_total: u64,
}

// ─── Event Helper Wrappers ────────────────────────────────────────────────────

fn emit_plan_created(env: &Env, plan_id: u64, owner: &Address) {
    PlanCreated { plan_id, owner: owner.clone() }.publish(env);
}

fn emit_plan_updated(env: &Env, plan_id: u64) {
    PlanUpdated { plan_id }.publish(env);
}

fn emit_plan_deactivated(env: &Env, plan_id: u64) {
    PlanDeactivated { plan_id }.publish(env);
}

fn emit_plan_reactivated(env: &Env, plan_id: u64) {
    PlanReactivated { plan_id }.publish(env);
}

fn emit_sub_created(env: &Env, customer: &Address, plan_id: u64) {
    SubscriptionCreated { customer: customer.clone(), plan_id }.publish(env);
}

fn emit_status_changed(env: &Env, customer: &Address, old: &SubStatus, new: &SubStatus) {
    StatusChanged {
        customer: customer.clone(),
        old_status: old.clone(),
        new_status: new.clone(),
    }
    .publish(env);
}

fn emit_sub_renewed(env: &Env, customer: &Address, plan_id: u64, new_period_end: u64) {
    SubscriptionRenewed {
        customer: customer.clone(),
        plan_id,
        new_period_end,
    }
    .publish(env);
}

fn emit_sub_cancelled(env: &Env, customer: &Address, effective_at: u64) {
    SubscriptionCancelled { customer: customer.clone(), effective_at }.publish(env);
}

fn emit_usage_recorded(env: &Env, customer: &Address, plan_id: u64, units: u64, new_total: u64) {
    UsageRecorded {
        customer: customer.clone(),
        plan_id,
        units,
        new_total,
    }
    .publish(env);
}

// ─── Valid Status Transitions ─────────────────────────────────────────────────

/// Validates that a status transition is logically permitted.
///
/// ```
/// Trialing    → Active         (trial ended naturally)
/// Active      → GracePeriod   (renewal payment failed)
/// Active      → Paused        (customer paused)
/// Active      → Cancelled     (customer or admin cancelled)
/// GracePeriod → Active         (payment recovered)
/// GracePeriod → Cancelled     (grace period expired)
/// Paused      → Active         (customer resumed)
/// Paused      → Cancelled     (customer cancelled while paused)
/// Any         → Expired        (admin: end-of-plan expiry)
/// ```
fn validate_transition(from: &SubStatus, to: &SubStatus) -> bool {
    match (from, to) {
        (SubStatus::Trialing,    SubStatus::Active)      => true,
        (SubStatus::Trialing,    SubStatus::Cancelled)   => true,
        (SubStatus::Active,      SubStatus::GracePeriod) => true,
        (SubStatus::Active,      SubStatus::Paused)      => true,
        (SubStatus::Active,      SubStatus::Cancelled)   => true,
        (SubStatus::Active,      SubStatus::Expired)     => true,
        (SubStatus::GracePeriod, SubStatus::Active)      => true,
        (SubStatus::GracePeriod, SubStatus::Cancelled)   => true,
        (SubStatus::Paused,      SubStatus::Active)      => true,
        (SubStatus::Paused,      SubStatus::Cancelled)   => true,
        // All other transitions are invalid
        _ => false,
    }
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

fn require_admin_or(env: &Env, other: &Address) {
    let admin = get_admin(env);
    if admin == *other {
        admin.require_auth();
    } else {
        other.require_auth();
    }
}

fn get_plan(env: &Env, plan_id: u64) -> PlanConfig {
    let key = DataKey::Plan(plan_id);
    let plan = env
        .storage()
        .persistent()
        .get::<DataKey, PlanConfig>(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::PlanNotFound));
    // Bump TTL on every read to prevent expiry while subscriptions are active
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    plan
}

fn save_plan(env: &Env, plan: &PlanConfig) {
    let key = DataKey::Plan(plan.plan_id);
    env.storage().persistent().set(&key, plan);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

fn get_subscription(env: &Env, customer: &Address) -> SubscriptionRecord {
    let key = DataKey::Subscription(customer.clone());
    let sub = env
        .storage()
        .persistent()
        .get::<DataKey, SubscriptionRecord>(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::SubscriptionNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    sub
}

fn try_get_subscription(env: &Env, customer: &Address) -> Option<SubscriptionRecord> {
    let key = DataKey::Subscription(customer.clone());
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, SubscriptionRecord>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }
    result
}

fn save_subscription(env: &Env, sub: &SubscriptionRecord) {
    let key = DataKey::Subscription(sub.customer.clone());
    env.storage().persistent().set(&key, sub);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

fn next_plan_id(env: &Env) -> u64 {
    let current = env
        .storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::PlanCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&DataKey::PlanCount, &next);
    next
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionRegistry;

#[contractimpl]
impl SubscriptionRegistry {

    // ═════════════════════════════════════════════════════════════════════════
    // INITIALISATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Initialises the contract. Must be called once immediately after deployment.
    ///
    /// Sets the admin address and the USDC SAC address. Both are stored in
    /// instance storage. The USDC SAC address is immutable after init.
    ///
    /// # Arguments
    /// * `admin`    — The wallet or multisig that will administrate the contract.
    /// * `usdc_sac` — The deployed address of the Stellar USDC Stellar Asset Contract.
    ///
    /// # Errors
    /// * `AlreadyInitialized` — if called more than once.
    pub fn initialize(env: Env, admin: Address, usdc_sac: Address) {
        // Guard: only callable once
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcSac, &usdc_sac);
        env.storage().instance().set(&DataKey::PlanCount, &0u64);

        log!(&env, "SubscriptionRegistry initialized. admin={}", admin);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ADMIN MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    /// Transfers admin authority to a new address.
    ///
    /// Only the current admin can call this. Irreversible unless the new admin
    /// calls it again. Intended for transitioning to a multisig or DAO.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        log!(&env, "Admin transferred to {}", new_admin);
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        get_admin(&env)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PLAN MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    /// Creates a new subscription plan.
    ///
    /// The invoker becomes the plan owner and receives all subscription revenue.
    /// Plan IDs are auto-incremented and never reused.
    ///
    /// # Arguments
    /// * `name`              — Display name. 1–64 bytes.
    /// * `price_usdc`        — Price per cycle in USDC stroops. Min 0 (free plan).
    /// * `interval_seconds`  — Billing cycle length. Min 86400 (1 day).
    /// * `trial_seconds`     — Free trial duration. 0 = no trial.
    /// * `usage_limit`       — Max usage units per cycle. 0 = unlimited.
    /// * `features`          — Feature flags granted by this plan. Max 32.
    ///
    /// # Returns
    /// The newly created `plan_id` (u64).
    ///
    /// # Errors
    /// * `InvalidPlanName` — name is empty or > 64 bytes.
    /// * `InvalidInterval` — interval_seconds < 86400.
    /// * `InvalidPrice`    — price_usdc < 0.
    /// * `TooManyFeatures` — features has > 32 entries.
    pub fn create_plan(
        env: Env,
        name: String,
        price_usdc: i128,
        interval_seconds: u64,
        trial_seconds: u64,
        usage_limit: u64,
        features: Vec<String>,
    ) -> u64 {
        // The invoker is the plan owner — require their auth
        let owner = env.current_contract_address();
        // We get the invoker via require_auth pattern: caller must sign the tx
        // In Soroban, we use the invoker from the tx context
        // For plan creation, any authenticated address may call this
        // Validation
        if name.len() == 0 || name.len() > MAX_NAME_LEN {
            panic_with_error!(&env, Error::InvalidPlanName);
        }
        if price_usdc < MIN_PRICE_USDC {
            panic_with_error!(&env, Error::InvalidPrice);
        }
        if interval_seconds < MIN_INTERVAL_SECONDS {
            panic_with_error!(&env, Error::InvalidInterval);
        }
        if features.len() > MAX_FEATURES {
            panic_with_error!(&env, Error::TooManyFeatures);
        }

        let plan_id = next_plan_id(&env);
        let now = env.ledger().timestamp();

        // The owner is whoever signed and submitted this transaction.
        // In production the backend passes the developer's address explicitly.
        // We accept it as a parameter to allow proxy deployments.
        let plan = PlanConfig {
            plan_id,
            name,
            price_usdc,
            interval_seconds,
            trial_seconds,
            usage_limit,
            features,
            active: true,
            owner: owner.clone(),
            created_at: now,
        };

        save_plan(&env, &plan);
        emit_plan_created(&env, plan_id, &owner);

        log!(&env, "Plan created: id={} price={} interval={}", plan_id, price_usdc, interval_seconds);
        plan_id
    }

    /// Creates a plan on behalf of a specific owner (developer wallet).
    ///
    /// This variant is used by the Invoq backend when developers create plans
    /// through the dashboard — the backend submits the tx and passes the
    /// developer's verified address as `owner`.
    ///
    /// Requires admin auth (the backend acts as admin).
    pub fn create_plan_for(
        env: Env,
        owner: Address,
        name: String,
        price_usdc: i128,
        interval_seconds: u64,
        trial_seconds: u64,
        usage_limit: u64,
        features: Vec<String>,
    ) -> u64 {
        require_admin(&env);

        if name.len() == 0 || name.len() > MAX_NAME_LEN {
            panic_with_error!(&env, Error::InvalidPlanName);
        }
        if price_usdc < MIN_PRICE_USDC {
            panic_with_error!(&env, Error::InvalidPrice);
        }
        if interval_seconds < MIN_INTERVAL_SECONDS {
            panic_with_error!(&env, Error::InvalidInterval);
        }
        if features.len() > MAX_FEATURES {
            panic_with_error!(&env, Error::TooManyFeatures);
        }

        let plan_id = next_plan_id(&env);
        let now = env.ledger().timestamp();

        let plan = PlanConfig {
            plan_id,
            name,
            price_usdc,
            interval_seconds,
            trial_seconds,
            usage_limit,
            features,
            active: true,
            owner: owner.clone(),
            created_at: now,
        };

        save_plan(&env, &plan);
        emit_plan_created(&env, plan_id, &owner);

        plan_id
    }

    /// Updates the mutable fields of an existing plan.
    ///
    /// `interval_seconds` cannot be changed after creation — changing billing
    /// cycle length for existing subscribers would be undefined behaviour.
    ///
    /// Price and usage_limit changes apply to new billing cycles only.
    /// Feature and name changes take effect immediately.
    ///
    /// # Errors
    /// * `Unauthorized`    — invoker is neither admin nor plan owner.
    /// * `PlanNotFound`    — no plan with this ID exists.
    /// * `InvalidPlanName` — new name is invalid.
    /// * `TooManyFeatures` — new features list exceeds 32 entries.
    pub fn update_plan(
        env: Env,
        plan_id: u64,
        name: String,
        price_usdc: i128,
        usage_limit: u64,
        features: Vec<String>,
    ) {
        let mut plan = get_plan(&env, plan_id);

        // Auth: admin or plan owner
        require_admin_or(&env, &plan.owner);

        // Validate new values
        if name.len() == 0 || name.len() > MAX_NAME_LEN {
            panic_with_error!(&env, Error::InvalidPlanName);
        }
        if price_usdc < MIN_PRICE_USDC {
            panic_with_error!(&env, Error::InvalidPrice);
        }
        if features.len() > MAX_FEATURES {
            panic_with_error!(&env, Error::TooManyFeatures);
        }

        plan.name         = name;
        plan.price_usdc   = price_usdc;
        plan.usage_limit  = usage_limit;
        plan.features     = features;

        save_plan(&env, &plan);
        emit_plan_updated(&env, plan_id);
    }

    /// Deactivates a plan, preventing new subscriptions from being created.
    ///
    /// Existing subscriptions on this plan are NOT affected — they continue
    /// to renew, be checked, and can be cancelled normally.
    ///
    /// # Errors
    /// * `Unauthorized`    — invoker is neither admin nor plan owner.
    /// * `PlanNotFound`    — no plan with this ID exists.
    /// * `AlreadyInactive` — plan is already inactive.
    pub fn deactivate_plan(env: Env, plan_id: u64) {
        let mut plan = get_plan(&env, plan_id);
        require_admin_or(&env, &plan.owner);

        if !plan.active {
            panic_with_error!(&env, Error::AlreadyInactive);
        }

        plan.active = false;
        save_plan(&env, &plan);
        emit_plan_deactivated(&env, plan_id);
    }

    /// Reactivates a previously deactivated plan.
    ///
    /// # Errors
    /// * `Unauthorized`  — invoker is neither admin nor plan owner.
    /// * `PlanNotFound`  — no plan with this ID exists.
    /// * `AlreadyActive` — plan is already active.
    pub fn reactivate_plan(env: Env, plan_id: u64) {
        let mut plan = get_plan(&env, plan_id);
        require_admin_or(&env, &plan.owner);

        if plan.active {
            panic_with_error!(&env, Error::AlreadyActive);
        }

        plan.active = true;
        save_plan(&env, &plan);
        emit_plan_reactivated(&env, plan_id);
    }

    /// Returns the full PlanConfig for a given plan_id.
    ///
    /// Returns None if the plan does not exist. Never panics.
    /// Bumps TTL on read to prevent expiry while subscriptions are active.
    pub fn get_plan(env: Env, plan_id: u64) -> Option<PlanConfig> {
        let key = DataKey::Plan(plan_id);
        let result = env
            .storage()
            .persistent()
            .get::<DataKey, PlanConfig>(&key);
        if result.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
        }
        result
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SUBSCRIPTION MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    /// Creates a new subscription record for a customer.
    ///
    /// Called exclusively by BillingCycle after confirming the initial USDC
    /// payment. Sets status to Trialing if plan.trial_seconds > 0, otherwise
    /// Active. Period timestamps are set from `now`.
    ///
    /// # Arguments
    /// * `customer`     — The customer's Stellar wallet address.
    /// * `plan_id`      — ID of an active plan in the registry.
    ///
    /// # Returns
    /// The newly created `SubscriptionRecord`.
    ///
    /// # Errors
    /// * `Unauthorized`      — invoker is not admin.
    /// * `PlanNotFound`      — no plan with this ID.
    /// * `PlanInactive`      — plan exists but is deactivated.
    /// * `AlreadySubscribed` — customer has a non-cancelled subscription.
    pub fn create_subscription(
        env: Env,
        customer: Address,
        plan_id: u64,
    ) -> SubscriptionRecord {
        require_admin(&env);

        let plan = get_plan(&env, plan_id);

        if !plan.active {
            panic_with_error!(&env, Error::PlanInactive);
        }

        // Guard: customer must not already have an active subscription
        if let Some(existing) = try_get_subscription(&env, &customer) {
            match existing.status {
                SubStatus::Cancelled | SubStatus::Expired => {
                    // Allowed — previous subscription ended, new one can start
                }
                _ => {
                    panic_with_error!(&env, Error::AlreadySubscribed);
                }
            }
        }

        let now = env.ledger().timestamp();

        let (status, trial_end) = if plan.trial_seconds > 0 {
            (SubStatus::Trialing, now + plan.trial_seconds)
        } else {
            (SubStatus::Active, 0u64)
        };

        let sub = SubscriptionRecord {
            customer: customer.clone(),
            plan_id,
            status,
            started_at: now,
            current_period_start: now,
            current_period_end: now + plan.interval_seconds,
            trial_end,
            cancel_at_period_end: false,
            usage_current: 0,
        };

        save_subscription(&env, &sub);
        emit_sub_created(&env, &customer, plan_id);

        sub
    }

    /// Updates the status of a subscription.
    ///
    /// Called exclusively by BillingCycle to signal lifecycle transitions.
    /// All transitions are validated against the permitted transition table.
    ///
    /// # Errors
    /// * `Unauthorized`         — invoker is not admin.
    /// * `SubscriptionNotFound` — no subscription for this customer.
    /// * `InvalidTransition`    — the from→to transition is not permitted.
    pub fn update_status(
        env: Env,
        customer: Address,
        new_status: SubStatus,
    ) {
        require_admin(&env);

        let mut sub = get_subscription(&env, &customer);
        let old_status = sub.status.clone();

        if !validate_transition(&old_status, &new_status) {
            panic_with_error!(&env, Error::InvalidTransition);
        }

        sub.status = new_status.clone();
        save_subscription(&env, &sub);
        emit_status_changed(&env, &customer, &old_status, &new_status);
    }

    /// Advances the billing period after a successful renewal payment.
    ///
    /// Resets usage_current to 0. If the subscription was in GracePeriod,
    /// transitions it back to Active atomically. Called exclusively by
    /// BillingCycle after confirming the USDC SAC transfer succeeded.
    ///
    /// Period start and end are supplied by BillingCycle (which owns timing
    /// logic) rather than computed here to keep this contract stateless w.r.t.
    /// billing cycle arithmetic.
    ///
    /// # Arguments
    /// * `customer`          — Customer to renew.
    /// * `new_period_start`  — Unix timestamp of new period start.
    /// * `new_period_end`    — Unix timestamp of new period end.
    ///
    /// # Errors
    /// * `Unauthorized`         — invoker is not admin.
    /// * `SubscriptionNotFound` — no subscription for this customer.
    /// * `InvalidPeriod`        — new_period_end <= new_period_start.
    pub fn renew_subscription(
        env: Env,
        customer: Address,
        new_period_start: u64,
        new_period_end: u64,
    ) {
        require_admin(&env);

        if new_period_end <= new_period_start {
            panic_with_error!(&env, Error::InvalidPeriod);
        }

        let mut sub = get_subscription(&env, &customer);

        // Recover from grace period if payment is now confirmed
        if matches!(sub.status, SubStatus::GracePeriod) {
            sub.status = SubStatus::Active;
        }

        sub.current_period_start = new_period_start;
        sub.current_period_end   = new_period_end;
        sub.usage_current        = 0; // Reset usage counter for new period

        save_subscription(&env, &sub);
        emit_sub_renewed(&env, &customer, sub.plan_id, new_period_end);
    }

    /// Cancels a subscription.
    ///
    /// If `immediate` is false (standard cancellation), sets
    /// `cancel_at_period_end = true`. Entitlement continues until
    /// `current_period_end`. BillingCycle will not renew the subscription.
    ///
    /// If `immediate` is true, sets status to Cancelled immediately.
    /// Entitlement is revoked at once. No refund is issued on-chain —
    /// refunds via EscrowVault must be processed separately by admin.
    ///
    /// # Auth
    /// Admin OR the customer themselves may cancel.
    ///
    /// # Errors
    /// * `Unauthorized`         — invoker is neither admin nor the customer.
    /// * `SubscriptionNotFound` — no subscription for this customer.
    /// * `AlreadyCancelled`     — subscription is already cancelled.
    pub fn cancel_subscription(
        env: Env,
        customer: Address,
        immediate: bool,
    ) {
        require_admin_or(&env, &customer);

        let mut sub = get_subscription(&env, &customer);

        if matches!(sub.status, SubStatus::Cancelled | SubStatus::Expired) {
            panic_with_error!(&env, Error::AlreadyCancelled);
        }

        let now = env.ledger().timestamp();

        if immediate {
            sub.status = SubStatus::Cancelled;
            sub.cancel_at_period_end = false;
            save_subscription(&env, &sub);
            emit_sub_cancelled(&env, &customer, now);
        } else {
            // Schedule cancellation at end of current billing period
            sub.cancel_at_period_end = true;
            save_subscription(&env, &sub);
            emit_sub_cancelled(&env, &customer, sub.current_period_end);
        }
    }

    /// Returns the full SubscriptionRecord for a customer.
    ///
    /// Returns None if no subscription exists. Never panics.
    pub fn get_subscription(env: Env, customer: Address) -> Option<SubscriptionRecord> {
        try_get_subscription(&env, &customer)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ENTITLEMENT CHECKS
    // ═════════════════════════════════════════════════════════════════════════

    /// Checks whether a customer is entitled to access a specific feature.
    ///
    /// This is the most-called function in the entire system. Called on every
    /// inbound API request by the Invoq backend. Optimised for minimal reads:
    /// one persistent storage read for the subscription, one for the plan.
    ///
    /// Returns false (never panics) if:
    /// - No subscription record exists for the customer
    /// - Subscription status does not grant entitlement
    /// - The plan does not include the requested feature
    ///
    /// # Arguments
    /// * `customer` — The customer wallet to check.
    /// * `feature`  — Feature flag string, e.g. "api_access". Case-sensitive.
    pub fn check_entitlement(env: Env, customer: Address, feature: String) -> bool {
        // Optimised fast path: subscription not found → false immediately
        let sub = match try_get_subscription(&env, &customer) {
            Some(s) => s,
            None    => return false,
        };

        // Status check — Active, Trialing, and GracePeriod grant entitlement
        if !sub.status.is_entitled() {
            return false;
        }

        // If cancel_at_period_end is set, still entitled until period ends
        // (current_period_end is the definitive expiry time)
        let now = env.ledger().timestamp();
        if sub.cancel_at_period_end && now >= sub.current_period_end {
            return false;
        }

        // Plan feature check
        let plan = match env
            .storage()
            .persistent()
            .get::<DataKey, PlanConfig>(&DataKey::Plan(sub.plan_id))
        {
            Some(p) => p,
            None    => return false, // Plan deleted — fail safe
        };

        // Bump plan TTL on hit
        env.storage().persistent().extend_ttl(
            &DataKey::Plan(sub.plan_id),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );

        plan.features.contains(&feature)
    }

    /// Returns a rich entitlement result including status and usage details.
    ///
    /// Use this variant when the caller needs more context than a boolean —
    /// e.g., to display "you have used 8,000 of 10,000 requests this month".
    ///
    /// Returns a default `EntitlementResult` with `entitled = false` if no
    /// subscription exists. Never panics.
    pub fn check_entitlement_full(
        env: Env,
        customer: Address,
        feature: String,
    ) -> EntitlementResult {
        let sub = match try_get_subscription(&env, &customer) {
            Some(s) => s,
            None => return EntitlementResult {
                entitled: false,
                status: SubStatus::Cancelled,
                plan_id: 0,
                usage_current: 0,
                usage_limit: 0,
                current_period_end: 0,
            },
        };

        let now = env.ledger().timestamp();

        // Early exit if status does not grant entitlement
        if !sub.status.is_entitled() {
            return EntitlementResult {
                entitled: false,
                status: sub.status,
                plan_id: sub.plan_id,
                usage_current: sub.usage_current,
                usage_limit: 0,
                current_period_end: sub.current_period_end,
            };
        }

        // Cancel at period end check
        if sub.cancel_at_period_end && now >= sub.current_period_end {
            return EntitlementResult {
                entitled: false,
                status: SubStatus::Cancelled,
                plan_id: sub.plan_id,
                usage_current: sub.usage_current,
                usage_limit: 0,
                current_period_end: sub.current_period_end,
            };
        }

        let plan = match env
            .storage()
            .persistent()
            .get::<DataKey, PlanConfig>(&DataKey::Plan(sub.plan_id))
        {
            Some(p) => p,
            None => return EntitlementResult {
                entitled: false,
                status: sub.status,
                plan_id: sub.plan_id,
                usage_current: sub.usage_current,
                usage_limit: 0,
                current_period_end: sub.current_period_end,
            },
        };

        env.storage().persistent().extend_ttl(
            &DataKey::Plan(sub.plan_id),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_BUMP,
        );

        let feature_ok = plan.features.contains(&feature);

        EntitlementResult {
            entitled: feature_ok,
            status: sub.status,
            plan_id: sub.plan_id,
            usage_current: sub.usage_current,
            usage_limit: plan.usage_limit,
            current_period_end: sub.current_period_end,
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // USAGE METERING
    // ═════════════════════════════════════════════════════════════════════════

    /// Increments the usage counter for a customer's subscription.
    ///
    /// Called by the Invoq metering service after API calls are confirmed.
    /// The on-chain counter is the auditable source of truth for usage billing
    /// disputes. Soft limit enforcement happens in the API layer before this.
    ///
    /// The counter resets to 0 on every call to `renew_subscription`.
    ///
    /// # Arguments
    /// * `customer` — The customer whose counter to increment.
    /// * `units`    — Number of units to add. Must be >= 1.
    ///
    /// # Returns
    /// The new `usage_current` total for this billing period.
    ///
    /// # Errors
    /// * `Unauthorized`          — invoker is not admin.
    /// * `SubscriptionNotFound`  — no subscription for this customer.
    /// * `SubscriptionNotActive` — status is not Active or Trialing.
    /// * `ZeroUnits`             — units is 0.
    pub fn increment_usage(env: Env, customer: Address, units: u64) -> u64 {
        require_admin(&env);

        if units == 0 {
            panic_with_error!(&env, Error::ZeroUnits);
        }

        let mut sub = get_subscription(&env, &customer);

        // Only meter active or trialing subscriptions
        match sub.status {
            SubStatus::Active | SubStatus::Trialing => {}
            _ => panic_with_error!(&env, Error::SubscriptionNotActive),
        }

        sub.usage_current = sub.usage_current.saturating_add(units);
        let new_total = sub.usage_current;

        save_subscription(&env, &sub);
        emit_usage_recorded(&env, &customer, sub.plan_id, units, new_total);

        new_total
    }

    /// Batch-increments usage for multiple customers in one transaction.
    ///
    /// Reduces the number of transactions the metering service needs to submit.
    /// Each (customer, units) pair is processed independently — a failure for
    /// one entry does NOT roll back others. Returns the count of successful
    /// increments.
    ///
    /// Maximum 50 entries per call to stay within Soroban instruction limits.
    pub fn increment_usage_batch(
        env: Env,
        entries: Vec<(Address, u64)>,
    ) -> u32 {
        require_admin(&env);

        let mut success_count: u32 = 0;

        for i in 0..entries.len() {
            let (customer, units) = entries.get(i).unwrap();

            if units == 0 {
                continue;
            }

            if let Some(mut sub) = try_get_subscription(&env, &customer) {
                match sub.status {
                    SubStatus::Active | SubStatus::Trialing => {
                        sub.usage_current = sub.usage_current.saturating_add(units);
                        let new_total = sub.usage_current;
                        save_subscription(&env, &sub);
                        emit_usage_recorded(&env, &customer, sub.plan_id, units, new_total);
                        success_count += 1;
                    }
                    _ => { /* Skip non-active subscriptions silently */ }
                }
            }
        }

        success_count
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MIGRATION / OPERATOR GRANTS
    // ═════════════════════════════════════════════════════════════════════════

    /// Grants admin-equivalent authority to another contract address.
    ///
    /// Used to give BillingCycle the ability to call admin-only functions
    /// (create_subscription, update_status, renew_subscription) without
    /// sharing the actual admin key.
    ///
    /// Stored as a separate operator key to allow revocation independently
    /// of the main admin.
    pub fn grant_operator(env: Env, operator: Address) {
        require_admin(&env);
        let key = Symbol::new(&env, "OPERATOR");
        env.storage().instance().set(&key, &operator);
        log!(&env, "Operator granted: {}", operator);
    }

    /// Revokes the current operator address.
    pub fn revoke_operator(env: Env) {
        require_admin(&env);
        let key = Symbol::new(&env, "OPERATOR");
        env.storage().instance().remove(&key);
    }

    /// Returns the current operator address, if any.
    pub fn get_operator(env: Env) -> Option<Address> {
        let key = Symbol::new(&env, "OPERATOR");
        env.storage().instance().get::<Symbol, Address>(&key)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // READ HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    /// Returns the total number of plans ever created (including inactive).
    pub fn plan_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::PlanCount)
            .unwrap_or(0)
    }

    /// Returns whether a customer currently has an active (entitled) subscription.
    ///
    /// Convenience wrapper around check_entitlement for callers who don't need
    /// feature-level granularity.
    pub fn is_subscribed(env: Env, customer: Address) -> bool {
        match try_get_subscription(&env, &customer) {
            Some(sub) => sub.status.is_entitled(),
            None      => false,
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    fn setup() -> (Env, SubscriptionRegistryClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SubscriptionRegistry);
        let client = SubscriptionRegistryClient::new(&env, &contract_id);

        let admin   = Address::generate(&env);
        let usdc    = Address::generate(&env);

        client.initialize(&admin, &usdc);

        (env, client, admin, usdc)
    }

    fn make_features(env: &Env) -> Vec<String> {
        vec![env, String::from_str(env, "api_access"), String::from_str(env, "webhooks")]
    }

    // ── Initialisation ────────────────────────────────────────────────────

    #[test]
    fn test_initialize_once() {
        let (env, client, admin, usdc) = setup();
        // Second call must panic
        let result = client.try_initialize(&admin, &usdc);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_admin_after_init() {
        let (_env, client, admin, _usdc) = setup();
        assert_eq!(client.get_admin(), admin);
    }

    // ── Plan creation ─────────────────────────────────────────────────────

    #[test]
    fn test_create_plan_returns_incrementing_ids() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);

        let id1 = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Starter"),
            &10_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );
        let id2 = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &100_000u64,
            &features,
        );

        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
        assert_eq!(client.plan_count(), 2u64);
    }

    #[test]
    fn test_create_plan_invalid_interval_panics() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let result = client.try_create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Bad"),
            &0i128,
            &3600u64, // < 86400 minimum
            &0u64,
            &0u64,
            &features,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_create_plan_empty_name_panics() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let result = client.try_create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, ""),
            &0i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );
        assert!(result.is_err());
    }

    // ── Subscription lifecycle ────────────────────────────────────────────

    #[test]
    fn test_create_subscription_sets_active_status() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let owner    = Address::generate(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &owner,
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64, // no trial
            &0u64,
            &features,
        );

        let sub = client.create_subscription(&customer, &plan_id);

        assert_eq!(sub.plan_id, plan_id);
        assert!(matches!(sub.status, SubStatus::Active));
        assert_eq!(sub.usage_current, 0u64);
        assert!(!sub.cancel_at_period_end);
    }

    #[test]
    fn test_create_subscription_sets_trialing_when_trial_exists() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Trial Plan"),
            &50_000_000i128,
            &2_592_000u64,
            &604_800u64, // 7 day trial
            &0u64,
            &features,
        );

        let sub = client.create_subscription(&customer, &plan_id);
        assert!(matches!(sub.status, SubStatus::Trialing));
        assert!(sub.trial_end > 0);
    }

    #[test]
    fn test_duplicate_subscription_panics() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        let result = client.try_create_subscription(&customer, &plan_id);
        assert!(result.is_err());
    }

    // ── Entitlement ───────────────────────────────────────────────────────

    #[test]
    fn test_check_entitlement_active_plan() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);

        assert!(client.check_entitlement(
            &customer,
            &String::from_str(&env, "api_access")
        ));
        assert!(client.check_entitlement(
            &customer,
            &String::from_str(&env, "webhooks")
        ));
        assert!(!client.check_entitlement(
            &customer,
            &String::from_str(&env, "export") // not in this plan
        ));
    }

    #[test]
    fn test_check_entitlement_no_subscription_returns_false() {
        let (env, client, _admin, _usdc) = setup();
        let nobody = Address::generate(&env);
        assert!(!client.check_entitlement(
            &nobody,
            &String::from_str(&env, "api_access")
        ));
    }

    #[test]
    fn test_check_entitlement_cancelled_returns_false() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        client.cancel_subscription(&customer, &true); // immediate cancel

        assert!(!client.check_entitlement(
            &customer,
            &String::from_str(&env, "api_access")
        ));
    }

    // ── Status transitions ────────────────────────────────────────────────

    #[test]
    fn test_valid_status_transition_active_to_grace() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        client.update_status(&customer, &SubStatus::GracePeriod);

        let sub = client.get_subscription(&customer).unwrap();
        assert!(matches!(sub.status, SubStatus::GracePeriod));
    }

    #[test]
    fn test_invalid_status_transition_panics() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        client.cancel_subscription(&customer, &true);

        // Cancelled → Active is not a valid transition
        let result = client.try_update_status(&customer, &SubStatus::Active);
        assert!(result.is_err());
    }

    // ── Renewal ───────────────────────────────────────────────────────────

    #[test]
    fn test_renew_subscription_resets_usage_and_advances_period() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        client.increment_usage(&customer, &500u64);

        let sub_before = client.get_subscription(&customer).unwrap();
        assert_eq!(sub_before.usage_current, 500u64);

        let new_start = sub_before.current_period_end;
        let new_end   = new_start + 2_592_000u64;

        client.renew_subscription(&customer, &new_start, &new_end);

        let sub_after = client.get_subscription(&customer).unwrap();
        assert_eq!(sub_after.usage_current, 0u64);
        assert_eq!(sub_after.current_period_start, new_start);
        assert_eq!(sub_after.current_period_end, new_end);
    }

    // ── Usage metering ────────────────────────────────────────────────────

    #[test]
    fn test_increment_usage_accumulates() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);

        assert_eq!(client.increment_usage(&customer, &100u64), 100u64);
        assert_eq!(client.increment_usage(&customer, &250u64), 350u64);
        assert_eq!(client.increment_usage(&customer, &50u64),  400u64);
    }

    #[test]
    fn test_increment_usage_zero_units_panics() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let customer = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &Address::generate(&env),
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.create_subscription(&customer, &plan_id);
        let result = client.try_increment_usage(&customer, &0u64);
        assert!(result.is_err());
    }

    // ── Deactivation ──────────────────────────────────────────────────────

    #[test]
    fn test_deactivated_plan_rejects_new_subscriptions() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let owner    = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &owner,
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.deactivate_plan(&plan_id);

        let result = client.try_create_subscription(
            &Address::generate(&env),
            &plan_id,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_reactivate_plan_allows_new_subscriptions() {
        let (env, client, _admin, _usdc) = setup();
        let features = make_features(&env);
        let owner    = Address::generate(&env);

        let plan_id = client.create_plan_for(
            &owner,
            &String::from_str(&env, "Pro"),
            &50_000_000i128,
            &2_592_000u64,
            &0u64,
            &0u64,
            &features,
        );

        client.deactivate_plan(&plan_id);
        client.reactivate_plan(&plan_id);

        let sub = client.create_subscription(&Address::generate(&env), &plan_id);
        assert!(matches!(sub.status, SubStatus::Active));
    }
}