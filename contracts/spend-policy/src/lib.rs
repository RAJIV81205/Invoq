#![no_std]

//! # SpendPolicy
//!
//! Per-agent and per-customer budget enforcement for Invoq.
//!
//! ## What it does
//!
//! SpendPolicy is an optional guardrail layer that enterprise customers and
//! developers can configure to control how deployed AI agents spend USDC.
//!
//! Without SpendPolicy, an agent that holds a valid Invoq subscription can
//! trigger API calls and payments without any budget ceiling. With SpendPolicy,
//! the platform enforces:
//!
//! - A daily USDC spending cap across all transactions
//! - A per-transaction USDC maximum
//! - A destination allowlist (payments only to approved addresses)
//! - A list of governed agent wallets
//!
//! ## Who uses it
//!
//! - Enterprise customers deploying multiple autonomous agents who need
//!   auditable budget controls (e.g. "Agent team A can spend max $500/day")
//! - Developers who want to add guardrails to customer-facing agents
//! - Any account where an agent operates with real money and a human needs
//!   oversight without being involved in every transaction
//!
//! ## How it integrates
//!
//! The Invoq API layer calls `check_spend` before executing any agent-initiated
//! payment. If the check returns false, the payment is rejected without touching
//! any funds. After a payment is confirmed on-chain, the API layer calls
//! `record_spend` to maintain the running daily total.
//!
//! SpendPolicy is completely standalone — it has no dependency on
//! SubscriptionRegistry or BillingCycle. It can be deployed independently.
//!
//! ## Access Control
//! - `initialize`       — once only, no auth
//! - `create_policy`    — any address (invoker becomes policy owner)
//! - `update_policy`    — policy owner only
//! - `deactivate_policy`— policy owner or admin
//! - `reactivate_policy`— policy owner or admin
//! - `record_spend`     — admin only (Invoq backend after confirmed payment)
//! - `transfer_admin`   — admin only
//! - `check_spend`      — public, read-only
//! - `get_policy`       — public, read-only
//! - `get_daily_spent`  — public, read-only
//! - `get_daily_limit_remaining` — public, read-only

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractevent,
    Address, Env, Vec,
    panic_with_error, log,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const LEDGERS_PER_YEAR: u32     = 6_307_200;
const PERSISTENT_TTL_THRESHOLD: u32 = LEDGERS_PER_YEAR;
const PERSISTENT_TTL_BUMP:      u32 = LEDGERS_PER_YEAR;

/// Maximum agents per policy
const MAX_AGENTS: u32 = 100;

/// Maximum allowlist entries per policy
const MAX_ALLOWLIST: u32 = 50;

/// Daily spend records are retained for 30 days (in ledgers ~5s each)
/// 30 days * 86400s/day / 5s = 518400 ledgers
const DAILY_SPEND_TTL: u32 = 518_400;

// ─── Error Codes ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized   = 1,
    NotInitialized       = 2,

    Unauthorized         = 10,

    PolicyAlreadyExists  = 20,
    PolicyNotFound       = 21,
    AlreadyInactive      = 22,
    AlreadyActive        = 23,
    TooManyAgents        = 24,
    TooManyAllowlist     = 25,

    InvalidAmount        = 30,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract admin — instance storage
    Admin,
    /// SpendPolicyConfig keyed by owner address — persistent storage
    Policy(Address),
    /// Maps agent address → owner address — persistent storage
    /// Enables O(1) policy lookup by agent address in check_spend.
    AgentOwner(Address),
    /// Running daily spend total.
    /// Key: (owner_address, utc_day_number) where day = timestamp / 86400
    /// Persistent storage, TTL = 30 days.
    DailySpent(Address, u64),
}

// ─── Data Structures ─────────────────────────────────────────────────────────

/// Full spend policy configuration for a policy owner.
#[contracttype]
#[derive(Clone)]
pub struct SpendPolicyConfig {
    /// The address that owns and controls this policy.
    pub owner: Address,

    /// Maximum USDC stroops that can be spent per UTC calendar day.
    /// 0 = no daily limit.
    pub daily_limit_usdc: i128,

    /// Maximum USDC stroops per individual transaction.
    /// 0 = no per-transaction limit.
    pub tx_limit_usdc: i128,

    /// Permitted destination addresses for payments.
    /// If non-empty, payments to any address not in this list are rejected.
    /// If empty, any destination is permitted.
    pub allowlist: Vec<Address>,

    /// Agent wallet addresses governed by this policy.
    /// Agents not in this list are not subject to this policy.
    pub agents: Vec<Address>,

    /// Whether this policy is currently active.
    /// When false, all check_spend calls for governed agents pass immediately.
    pub active: bool,

    /// Unix timestamp when this policy was created.
    pub created_at: u64,
}

/// Result returned by check_spend with detailed rejection reason.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SpendCheckResult {
    /// Payment is permitted.
    Allowed,
    /// Payment rejected — destination is not in the allowlist.
    BlockedByAllowlist,
    /// Payment rejected — amount exceeds per-transaction limit.
    BlockedByTxLimit,
    /// Payment rejected — would exceed daily spending cap.
    BlockedByDailyLimit,
    /// No policy governs this agent — payment is permitted.
    NoPolicyFound,
}

impl SpendCheckResult {
    pub fn is_allowed(&self) -> bool {
        matches!(self, SpendCheckResult::Allowed | SpendCheckResult::NoPolicyFound)
    }
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct PolicyCreated {
    #[topic] pub owner: Address,
    pub agent_count: u32,
}

#[contractevent]
pub struct PolicyUpdated {
    #[topic] pub owner: Address,
}

#[contractevent]
pub struct PolicyDeactivated {
    #[topic] pub owner: Address,
}

#[contractevent]
pub struct PolicyReactivated {
    #[topic] pub owner: Address,
}

#[contractevent]
pub struct SpendRecorded {
    #[topic] pub agent:       Address,
    #[topic] pub owner:       Address,
    pub amount_usdc:  i128,
    pub daily_total:  i128,
    pub day_number:   u64,
}

#[contractevent]
pub struct SpendBlocked {
    #[topic] pub agent:       Address,
    pub reason:       SpendCheckResult,
    pub amount_usdc:  i128,
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn require_admin(env: &Env, caller: &Address) {
    let admin = load_admin(env);
    if *caller != admin {
        panic_with_error!(env, Error::Unauthorized);
    }
    caller.require_auth();
}

fn require_owner_or_admin(env: &Env, caller: &Address, owner: &Address) {
    let admin = load_admin(env);
    if *caller != admin && *caller != *owner {
        panic_with_error!(env, Error::Unauthorized);
    }
    caller.require_auth();
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

fn load_policy(env: &Env, owner: &Address) -> SpendPolicyConfig {
    let key = DataKey::Policy(owner.clone());
    let policy = env
        .storage()
        .persistent()
        .get::<DataKey, SpendPolicyConfig>(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::PolicyNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    policy
}

fn try_load_policy(env: &Env, owner: &Address) -> Option<SpendPolicyConfig> {
    let key = DataKey::Policy(owner.clone());
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, SpendPolicyConfig>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }
    result
}

fn store_policy(env: &Env, policy: &SpendPolicyConfig) {
    let key = DataKey::Policy(policy.owner.clone());
    env.storage().persistent().set(&key, policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

/// Returns the policy owner for an agent address, if one is registered.
fn agent_owner(env: &Env, agent: &Address) -> Option<Address> {
    let key = DataKey::AgentOwner(agent.clone());
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, Address>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }
    result
}

/// Registers agent → owner mapping for fast policy lookup.
fn register_agent(env: &Env, agent: &Address, owner: &Address) {
    let key = DataKey::AgentOwner(agent.clone());
    env.storage().persistent().set(&key, owner);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

/// Removes the agent → owner mapping.
fn deregister_agent(env: &Env, agent: &Address) {
    let key = DataKey::AgentOwner(agent.clone());
    env.storage().persistent().remove(&key);
}

/// Returns the UTC day number for a given Unix timestamp.
/// day = timestamp / 86400 (integer division — floor to start of day UTC)
fn day_number(timestamp: u64) -> u64 {
    timestamp / 86_400
}

/// Returns the running daily spend total for an owner on a given day.
fn load_daily_spent(env: &Env, owner: &Address, day: u64) -> i128 {
    let key = DataKey::DailySpent(owner.clone(), day);
    env.storage()
        .persistent()
        .get::<DataKey, i128>(&key)
        .unwrap_or(0i128)
}

/// Adds `amount` to the daily spend total for an owner. Returns new total.
fn add_daily_spent(env: &Env, owner: &Address, day: u64, amount: i128) -> i128 {
    let key = DataKey::DailySpent(owner.clone(), day);
    let current: i128 = env
        .storage()
        .persistent()
        .get::<DataKey, i128>(&key)
        .unwrap_or(0i128);
    let new_total = current.saturating_add(amount);
    env.storage().persistent().set(&key, &new_total);
    // Daily spend records expire after 30 days — no need to retain forever
    env.storage()
        .persistent()
        .extend_ttl(&key, DAILY_SPEND_TTL, DAILY_SPEND_TTL);
    new_total
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SpendPolicy;

#[contractimpl]
impl SpendPolicy {

    // ═════════════════════════════════════════════════════════════════════════
    // INITIALISATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Initialises the SpendPolicy contract.
    ///
    /// SpendPolicy is standalone — it has no dependency on Registry or
    /// BillingCycle and can be deployed in any order.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        log!(&env, "SpendPolicy initialized. admin={}", admin);
    }

    /// Transfers admin authority to a new address.
    pub fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        require_admin(&env, &caller);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        log!(&env, "SpendPolicy admin transferred to {}", new_admin);
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // POLICY MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    /// Creates a new spend policy.
    ///
    /// The invoker becomes the policy owner. Any authenticated address can call
    /// this — it is not restricted to admin. The owner address must be the signer.
    ///
    /// Registers each agent in `agents` in the AgentOwner index for O(1) lookup.
    ///
    /// # Arguments
    /// * `owner`            — The policy owner. Must have signed the transaction.
    /// * `daily_limit_usdc` — Daily cap in USDC stroops. 0 = unlimited.
    /// * `tx_limit_usdc`    — Per-transaction cap. 0 = unlimited.
    /// * `allowlist`        — Permitted destinations. Empty = all destinations OK.
    /// * `agents`           — Agent wallets governed by this policy. Max 100.
    ///
    /// # Errors
    /// * `PolicyAlreadyExists` — A policy already exists for this owner.
    /// * `TooManyAgents`       — agents Vec exceeds 100 entries.
    /// * `TooManyAllowlist`    — allowlist Vec exceeds 50 entries.
    /// * `InvalidAmount`       — daily or tx limit is negative.
    pub fn create_policy(
        env: Env,
        owner: Address,
        daily_limit_usdc: i128,
        tx_limit_usdc: i128,
        allowlist: Vec<Address>,
        agents: Vec<Address>,
    ) {
        owner.require_auth();

        if env.storage().persistent().has(&DataKey::Policy(owner.clone())) {
            panic_with_error!(&env, Error::PolicyAlreadyExists);
        }
        if daily_limit_usdc < 0 || tx_limit_usdc < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if agents.len() > MAX_AGENTS {
            panic_with_error!(&env, Error::TooManyAgents);
        }
        if allowlist.len() > MAX_ALLOWLIST {
            panic_with_error!(&env, Error::TooManyAllowlist);
        }

        let now = env.ledger().timestamp();
        let agent_count = agents.len();

        // Register each agent → owner mapping for fast check_spend lookup
        for i in 0..agents.len() {
            let agent = agents.get(i).unwrap();
            register_agent(&env, &agent, &owner);
        }

        let policy = SpendPolicyConfig {
            owner:            owner.clone(),
            daily_limit_usdc,
            tx_limit_usdc,
            allowlist,
            agents,
            active:           true,
            created_at:       now,
        };

        store_policy(&env, &policy);

        PolicyCreated {
            owner,
            agent_count,
        }
        .publish(&env);
    }

    /// Updates an existing policy.
    ///
    /// Only the policy owner can update their own policy.
    /// All fields are replaced atomically — pass existing values for fields
    /// you don't want to change.
    ///
    /// Agent list changes are reflected in the AgentOwner index:
    ///   - Agents removed from the list are deregistered.
    ///   - Agents added to the list are registered.
    ///
    /// # Errors
    /// * `PolicyNotFound`  — No policy exists for this owner.
    /// * `Unauthorized`    — Caller is not the policy owner or admin.
    /// * `TooManyAgents`   — New agents list exceeds 100 entries.
    /// * `TooManyAllowlist`— New allowlist exceeds 50 entries.
    pub fn update_policy(
        env: Env,
        caller: Address,
        daily_limit_usdc: i128,
        tx_limit_usdc: i128,
        allowlist: Vec<Address>,
        agents: Vec<Address>,
    ) {
        let mut policy = load_policy(&env, &caller);
        require_owner_or_admin(&env, &caller, &policy.owner);

        if daily_limit_usdc < 0 || tx_limit_usdc < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if agents.len() > MAX_AGENTS {
            panic_with_error!(&env, Error::TooManyAgents);
        }
        if allowlist.len() > MAX_ALLOWLIST {
            panic_with_error!(&env, Error::TooManyAllowlist);
        }

        // Deregister agents that are being removed from the list
        for i in 0..policy.agents.len() {
            let old_agent = policy.agents.get(i).unwrap();
            // Check if this agent is in the new list
            let still_governed = agents.contains(&old_agent);
            if !still_governed {
                deregister_agent(&env, &old_agent);
            }
        }

        // Register newly added agents
        for i in 0..agents.len() {
            let new_agent = agents.get(i).unwrap();
            register_agent(&env, &new_agent, &policy.owner);
        }

        policy.daily_limit_usdc = daily_limit_usdc;
        policy.tx_limit_usdc    = tx_limit_usdc;
        policy.allowlist        = allowlist;
        policy.agents           = agents;

        store_policy(&env, &policy);

        PolicyUpdated {
            owner: policy.owner,
        }
        .publish(&env);
    }

    /// Deactivates a policy.
    ///
    /// While inactive, all check_spend calls for governed agents return
    /// `Allowed` immediately without any limit checking. Used for emergency
    /// situations where normal budget rules need to be bypassed.
    ///
    /// Policy owner or admin can deactivate.
    pub fn deactivate_policy(env: Env, caller: Address) {
        let mut policy = load_policy(&env, &caller);
        require_owner_or_admin(&env, &caller, &policy.owner);

        if !policy.active {
            panic_with_error!(&env, Error::AlreadyInactive);
        }

        policy.active = false;
        store_policy(&env, &policy);

        PolicyDeactivated {
            owner: policy.owner,
        }
        .publish(&env);
    }

    /// Reactivates a previously deactivated policy.
    pub fn reactivate_policy(env: Env, caller: Address) {
        let mut policy = load_policy(&env, &caller);
        require_owner_or_admin(&env, &caller, &policy.owner);

        if policy.active {
            panic_with_error!(&env, Error::AlreadyActive);
        }

        policy.active = true;
        store_policy(&env, &policy);

        PolicyReactivated {
            owner: policy.owner,
        }
        .publish(&env);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SPEND CHECKING  (the hot path — called before every agent payment)
    // ═════════════════════════════════════════════════════════════════════════

    /// Checks whether a proposed payment from an agent is permitted.
    ///
    /// This is the primary enforcement function. The Invoq API layer calls this
    /// before executing any agent-initiated payment.
    ///
    /// Returns a `SpendCheckResult`:
    /// - `Allowed`              — payment is permitted
    /// - `NoPolicyFound`        — no policy governs this agent (permit)
    /// - `BlockedByAllowlist`   — destination not in allowlist (reject)
    /// - `BlockedByTxLimit`     — amount > tx_limit_usdc (reject)
    /// - `BlockedByDailyLimit`  — would exceed daily_limit_usdc (reject)
    ///
    /// Never panics — any missing data results in `NoPolicyFound` (permit).
    /// This is a safe default: absence of a policy should never block payments.
    ///
    /// # Arguments
    /// * `agent`       — The agent wallet attempting the payment.
    /// * `destination` — The address the payment would be sent to.
    /// * `amount_usdc` — The proposed payment in USDC stroops.
    pub fn check_spend(
        env: Env,
        agent: Address,
        destination: Address,
        amount_usdc: i128,
    ) -> SpendCheckResult {
        // Fast path: no policy registered for this agent
        let owner = match agent_owner(&env, &agent) {
            Some(o) => o,
            None    => return SpendCheckResult::NoPolicyFound,
        };

        let policy = match try_load_policy(&env, &owner) {
            Some(p) => p,
            None    => return SpendCheckResult::NoPolicyFound,
        };

        // Inactive policy — all payments permitted
        if !policy.active {
            return SpendCheckResult::Allowed;
        }

        // Check 1: Allowlist (if non-empty, destination must be in it)
        if policy.allowlist.len() > 0 && !policy.allowlist.contains(&destination) {
            return SpendCheckResult::BlockedByAllowlist;
        }

        // Check 2: Per-transaction limit
        if policy.tx_limit_usdc > 0 && amount_usdc > policy.tx_limit_usdc {
            return SpendCheckResult::BlockedByTxLimit;
        }

        // Check 3: Daily limit
        if policy.daily_limit_usdc > 0 {
            let today = day_number(env.ledger().timestamp());
            let spent_today = load_daily_spent(&env, &owner, today);
            if spent_today.saturating_add(amount_usdc) > policy.daily_limit_usdc {
                return SpendCheckResult::BlockedByDailyLimit;
            }
        }

        SpendCheckResult::Allowed
    }

    /// Simplified boolean check — returns true if the payment is permitted.
    ///
    /// Use this when you don't need the detailed rejection reason.
    /// Internally calls `check_spend` and returns `result.is_allowed()`.
    pub fn is_spend_allowed(
        env: Env,
        agent: Address,
        destination: Address,
        amount_usdc: i128,
    ) -> bool {
        let result = Self::check_spend(env, agent, destination, amount_usdc);
        result.is_allowed()
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SPEND RECORDING  (called after a confirmed payment)
    // ═════════════════════════════════════════════════════════════════════════

    /// Records a confirmed USDC spend against the agent's governing policy.
    ///
    /// Called by the Invoq backend (admin) AFTER a payment is confirmed on-chain.
    /// This is the audit trail, not the enforcement gate — check_spend enforces,
    /// record_spend records.
    ///
    /// Increments the daily spend counter for today's UTC day. The counter key
    /// is `(owner_address, day_number)` so it naturally resets every UTC day
    /// without requiring an explicit reset call.
    ///
    /// # Arguments
    /// * `caller`      — Must be admin.
    /// * `agent`       — The agent that made the payment.
    /// * `amount_usdc` — The confirmed payment amount in USDC stroops.
    ///
    /// # Returns
    /// The new daily total for this policy owner.
    ///
    /// # Errors
    /// * `Unauthorized`   — caller is not admin.
    /// * `InvalidAmount`  — amount is 0 or negative.
    /// * `PolicyNotFound` — no policy registered for this agent (still records;
    ///                      this is a no-op if owner lookup fails).
    pub fn record_spend(
        env: Env,
        caller: Address,
        agent: Address,
        amount_usdc: i128,
    ) -> i128 {
        require_admin(&env, &caller);

        if amount_usdc <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        // Look up the owner for this agent
        let owner = match agent_owner(&env, &agent) {
            Some(o) => o,
            None    => return 0i128, // No policy — no-op, return 0
        };

        let today     = day_number(env.ledger().timestamp());
        let new_total = add_daily_spent(&env, &owner, today, amount_usdc);

        SpendRecorded {
            agent,
            owner,
            amount_usdc,
            daily_total: new_total,
            day_number:  today,
        }
        .publish(&env);

        new_total
    }

    // ═════════════════════════════════════════════════════════════════════════
    // READ FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /// Returns the full SpendPolicyConfig for a given owner, or None.
    pub fn get_policy(env: Env, owner: Address) -> Option<SpendPolicyConfig> {
        try_load_policy(&env, &owner)
    }

    /// Returns the policy owner for a given agent address, or None.
    pub fn get_agent_owner(env: Env, agent: Address) -> Option<Address> {
        agent_owner(&env, &agent)
    }

    /// Returns the total USDC spent today for a policy owner.
    ///
    /// `day` is a Unix timestamp — this function extracts the day number
    /// internally. Pass `env.ledger().timestamp()` for the current day.
    /// Returns 0 if no spend has been recorded today.
    pub fn get_daily_spent(env: Env, owner: Address, timestamp: u64) -> i128 {
        let day = day_number(timestamp);
        load_daily_spent(&env, &owner, day)
    }

    /// Returns the remaining daily allowance for a policy owner.
    ///
    /// Returns i128::MAX if no daily limit is set (0 = unlimited).
    /// Returns 0 if the daily limit has been exhausted.
    pub fn get_daily_limit_remaining(env: Env, owner: Address, timestamp: u64) -> i128 {
        let policy = match try_load_policy(&env, &owner) {
            Some(p) => p,
            None    => return i128::MAX,
        };

        if policy.daily_limit_usdc == 0 {
            return i128::MAX; // Unlimited
        }

        let day   = day_number(timestamp);
        let spent = load_daily_spent(&env, &owner, day);
        let remaining = policy.daily_limit_usdc.saturating_sub(spent);
        remaining.max(0)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    struct TestCtx {
        env:    Env,
        client: SpendPolicyClient<'static>,
        admin:  Address,
    }

    fn setup() -> TestCtx {
        let env    = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SpendPolicy);
        let client = SpendPolicyClient::new(&env, &contract_id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        TestCtx { env, client, admin }
    }

    fn make_agents(env: &Env, n: u32) -> Vec<Address> {
        let mut v = soroban_sdk::vec![env];
        for _ in 0..n {
            v.push_back(Address::generate(env));
        }
        v
    }

    fn make_allowlist(env: &Env, addrs: &[Address]) -> Vec<Address> {
        let mut v = soroban_sdk::vec![env];
        for a in addrs {
            v.push_back(a.clone());
        }
        v
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    #[test]
    fn test_init_once() {
        let ctx = setup();
        assert!(ctx.client.try_initialize(&ctx.admin).is_err());
    }

    #[test]
    fn test_get_admin() {
        let ctx = setup();
        assert_eq!(ctx.client.get_admin(), ctx.admin);
    }

    // ── Policy creation ───────────────────────────────────────────────────────

    #[test]
    fn test_create_policy_basic() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = soroban_sdk::vec![&ctx.env];

        ctx.client.create_policy(
            &owner,
            &100_000_000i128,  // 10 USDC/day
            &10_000_000i128,   // 1 USDC/tx
            &allowlist,
            &agents,
        );

        let policy = ctx.client.get_policy(&owner).unwrap();
        assert_eq!(policy.owner,            owner);
        assert_eq!(policy.daily_limit_usdc, 100_000_000i128);
        assert_eq!(policy.tx_limit_usdc,    10_000_000i128);
        assert!(policy.active);
        assert_eq!(ctx.client.get_agent_owner(&agent), Some(owner));
    }

    #[test]
    fn test_duplicate_policy_rejected() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let empty = soroban_sdk::vec![&ctx.env];

        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &empty);
        assert!(ctx.client.try_create_policy(&owner, &0i128, &0i128, &empty, &empty).is_err());
    }

    #[test]
    fn test_too_many_agents_rejected() {
        let ctx    = setup();
        let owner  = Address::generate(&ctx.env);
        let agents = make_agents(&ctx.env, 101); // over MAX_AGENTS of 100
        let empty  = soroban_sdk::vec![&ctx.env];

        assert!(ctx.client
            .try_create_policy(&owner, &0i128, &0i128, &empty, &agents)
            .is_err());
    }

    #[test]
    fn test_negative_limit_rejected() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let empty = soroban_sdk::vec![&ctx.env];

        assert!(ctx.client
            .try_create_policy(&owner, &-1i128, &0i128, &empty, &empty)
            .is_err());
    }

    // ── check_spend ───────────────────────────────────────────────────────────

    #[test]
    fn test_no_policy_returns_no_policy_found() {
        let ctx   = setup();
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);

        let result = ctx.client.check_spend(&agent, &dest, &1_000_000i128);
        assert!(result.is_allowed());
        assert!(matches!(result, SpendCheckResult::NoPolicyFound));
    }

    #[test]
    fn test_check_spend_allowed_within_limits() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = make_allowlist(&ctx.env, &[dest.clone()]);

        ctx.client.create_policy(
            &owner,
            &100_000_000i128, // 10 USDC/day
            &20_000_000i128,  // 2 USDC/tx
            &allowlist,
            &agents,
        );

        let result = ctx.client.check_spend(&agent, &dest, &10_000_000i128); // 1 USDC
        assert!(matches!(result, SpendCheckResult::Allowed));
    }

    #[test]
    fn test_check_spend_blocked_by_allowlist() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);
        let other = Address::generate(&ctx.env); // not in allowlist

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = make_allowlist(&ctx.env, &[dest.clone()]);

        ctx.client.create_policy(&owner, &0i128, &0i128, &allowlist, &agents);

        let result = ctx.client.check_spend(&agent, &other, &1_000_000i128);
        assert!(!result.is_allowed());
        assert!(matches!(result, SpendCheckResult::BlockedByAllowlist));
    }

    #[test]
    fn test_check_spend_blocked_by_tx_limit() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = soroban_sdk::vec![&ctx.env]; // no allowlist

        ctx.client.create_policy(
            &owner,
            &0i128,          // no daily limit
            &5_000_000i128,  // 0.5 USDC/tx max
            &allowlist,
            &agents,
        );

        let result = ctx.client.check_spend(&agent, &dest, &10_000_000i128); // 1 USDC > 0.5 USDC
        assert!(!result.is_allowed());
        assert!(matches!(result, SpendCheckResult::BlockedByTxLimit));
    }

    #[test]
    fn test_check_spend_blocked_by_daily_limit() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = soroban_sdk::vec![&ctx.env];

        ctx.client.create_policy(
            &owner,
            &10_000_000i128, // 1 USDC/day
            &0i128,
            &allowlist,
            &agents,
        );

        // Record 0.8 USDC spent already today
        ctx.client.record_spend(&ctx.admin, &agent, &8_000_000i128);

        // Attempt 0.5 USDC — would take total to 1.3 USDC, over the 1 USDC cap
        let result = ctx.client.check_spend(&agent, &dest, &5_000_000i128);
        assert!(!result.is_allowed());
        assert!(matches!(result, SpendCheckResult::BlockedByDailyLimit));
    }

    #[test]
    fn test_inactive_policy_allows_all_payments() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);
        let other = Address::generate(&ctx.env);

        let agents    = make_allowlist(&ctx.env, &[agent.clone()]);
        let allowlist = make_allowlist(&ctx.env, &[dest.clone()]);

        ctx.client.create_policy(&owner, &1_000i128, &1_000i128, &allowlist, &agents);
        ctx.client.deactivate_policy(&owner);

        // Would normally be blocked by allowlist and daily limit — but policy is inactive
        let result = ctx.client.check_spend(&agent, &other, &1_000_000_000i128);
        assert!(matches!(result, SpendCheckResult::Allowed));
    }

    // ── record_spend ──────────────────────────────────────────────────────────

    #[test]
    fn test_record_spend_accumulates_daily() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);

        let agents = make_allowlist(&ctx.env, &[agent.clone()]);
        let empty  = soroban_sdk::vec![&ctx.env];
        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &agents);

        let now = ctx.env.ledger().timestamp();

        let t1 = ctx.client.record_spend(&ctx.admin, &agent, &5_000_000i128);
        assert_eq!(t1, 5_000_000i128);

        let t2 = ctx.client.record_spend(&ctx.admin, &agent, &3_000_000i128);
        assert_eq!(t2, 8_000_000i128);

        assert_eq!(ctx.client.get_daily_spent(&owner, &now), 8_000_000i128);
    }

    #[test]
    fn test_record_spend_zero_rejected() {
        let ctx   = setup();
        let agent = Address::generate(&ctx.env);
        assert!(ctx.client.try_record_spend(&ctx.admin, &agent, &0i128).is_err());
    }

    #[test]
    fn test_record_spend_unknown_agent_returns_zero() {
        let ctx   = setup();
        let agent = Address::generate(&ctx.env); // no policy
        let total = ctx.client.record_spend(&ctx.admin, &agent, &1_000_000i128);
        assert_eq!(total, 0i128); // no-op
    }

    // ── daily_limit_remaining ─────────────────────────────────────────────────

    #[test]
    fn test_daily_limit_remaining_decreases() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);

        let agents = make_allowlist(&ctx.env, &[agent.clone()]);
        let empty  = soroban_sdk::vec![&ctx.env];
        ctx.client.create_policy(
            &owner,
            &100_000_000i128, // 10 USDC/day
            &0i128, &empty, &agents,
        );

        let now = ctx.env.ledger().timestamp();

        let before = ctx.client.get_daily_limit_remaining(&owner, &now);
        assert_eq!(before, 100_000_000i128);

        ctx.client.record_spend(&ctx.admin, &agent, &30_000_000i128);

        let after = ctx.client.get_daily_limit_remaining(&owner, &now);
        assert_eq!(after, 70_000_000i128);
    }

    #[test]
    fn test_daily_limit_remaining_unlimited_returns_max() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let empty = soroban_sdk::vec![&ctx.env];
        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &empty);

        let remaining = ctx.client.get_daily_limit_remaining(&owner, &0u64);
        assert_eq!(remaining, i128::MAX);
    }

    // ── update_policy ─────────────────────────────────────────────────────────

    #[test]
    fn test_update_policy_changes_limits() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);

        let agents = make_allowlist(&ctx.env, &[agent.clone()]);
        let empty  = soroban_sdk::vec![&ctx.env];

        ctx.client.create_policy(&owner, &100_000_000i128, &10_000_000i128, &empty, &agents);
        ctx.client.update_policy(
            &owner,
            &200_000_000i128, // doubled daily limit
            &5_000_000i128,   // halved tx limit
            &empty,
            &agents,
        );

        let policy = ctx.client.get_policy(&owner).unwrap();
        assert_eq!(policy.daily_limit_usdc, 200_000_000i128);
        assert_eq!(policy.tx_limit_usdc,    5_000_000i128);
    }

    #[test]
    fn test_update_policy_deregisters_removed_agents() {
        let ctx    = setup();
        let owner  = Address::generate(&ctx.env);
        let agent1 = Address::generate(&ctx.env);
        let agent2 = Address::generate(&ctx.env);
        let empty  = soroban_sdk::vec![&ctx.env];

        let agents_both = make_allowlist(&ctx.env, &[agent1.clone(), agent2.clone()]);
        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &agents_both);

        // Verify both registered
        assert_eq!(ctx.client.get_agent_owner(&agent1), Some(owner.clone()));
        assert_eq!(ctx.client.get_agent_owner(&agent2), Some(owner.clone()));

        // Update: remove agent2
        let agents_one = make_allowlist(&ctx.env, &[agent1.clone()]);
        ctx.client.update_policy(&owner, &0i128, &0i128, &empty, &agents_one);

        assert_eq!(ctx.client.get_agent_owner(&agent1), Some(owner.clone()));
        assert_eq!(ctx.client.get_agent_owner(&agent2), None); // deregistered
    }

    // ── deactivate / reactivate ───────────────────────────────────────────────

    #[test]
    fn test_deactivate_reactivate_cycle() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let empty = soroban_sdk::vec![&ctx.env];

        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &empty);
        assert!(ctx.client.get_policy(&owner).unwrap().active);

        ctx.client.deactivate_policy(&owner);
        assert!(!ctx.client.get_policy(&owner).unwrap().active);

        ctx.client.reactivate_policy(&owner);
        assert!(ctx.client.get_policy(&owner).unwrap().active);
    }

    #[test]
    fn test_double_deactivate_rejected() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let empty = soroban_sdk::vec![&ctx.env];
        ctx.client.create_policy(&owner, &0i128, &0i128, &empty, &empty);
        ctx.client.deactivate_policy(&owner);
        assert!(ctx.client.try_deactivate_policy(&owner).is_err());
    }

    // ── is_spend_allowed convenience wrapper ──────────────────────────────────

    #[test]
    fn test_is_spend_allowed_wrapper() {
        let ctx   = setup();
        let owner = Address::generate(&ctx.env);
        let agent = Address::generate(&ctx.env);
        let dest  = Address::generate(&ctx.env);

        let agents = make_allowlist(&ctx.env, &[agent.clone()]);
        let empty  = soroban_sdk::vec![&ctx.env];
        ctx.client.create_policy(&owner, &10_000_000i128, &0i128, &empty, &agents);

        assert!(ctx.client.is_spend_allowed(&agent, &dest, &5_000_000i128));

        // Exhaust the daily limit
        ctx.client.record_spend(&ctx.admin, &agent, &10_000_000i128);
        assert!(!ctx.client.is_spend_allowed(&agent, &dest, &1_000_000i128));
    }
}