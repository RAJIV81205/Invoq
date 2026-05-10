#![no_std]

//! # EscrowVault
//!
//! Prepaid USDC credit vaults for Invoq's usage-based billing model.
//!
//! ## What it does
//!
//! EscrowVault lets customers pre-deposit USDC into a vault that the Invoq
//! metering service draws down in real time as they consume API resources.
//!
//! This model is preferred by AI API developers because it eliminates
//! per-request payment overhead while still settling every charge on-chain.
//!
//! A customer deposits USDC → uses the API → each API call debits the vault
//! → revenue flows directly to the developer's wallet → customer withdraws
//! any unspent balance at any time, no lock-up, no questions.
//!
//! ## Key properties
//!
//! - **Non-custodial**: The contract holds USDC on behalf of customers, but
//!   only the customer can withdraw their own balance. The Invoq platform
//!   (admin) can only debit for actual API usage that the customer triggered.
//!
//! - **Developer-native**: Debits go directly to the developer's wallet —
//!   no intermediate escrow release step, no batch settlement. Revenue is
//!   instant.
//!
//! - **Auto top-up**: Customers can configure an automatic top-up that
//!   triggers when the vault balance falls below a configurable threshold.
//!   Requires a pre-approved USDC SAC allowance.
//!
//! - **One vault per (customer, developer) pair**: A single customer can
//!   fund vaults for multiple developers simultaneously. Each vault is
//!   independent.
//!
//! ## Who uses it
//!
//! - AI API developers charging per token or per task
//! - Data providers charging per API call or per record
//! - Enterprise customers who want predictable monthly spend with an on-chain
//!   audit trail of every charge
//!
//! ## USDC flow
//!
//! All transfers use the Stellar USDC SAC (Stellar Asset Contract):
//! - `deposit`: SAC `transfer` from customer → this contract
//! - `debit_vault`: SAC `transfer` from this contract → developer
//! - `withdraw`: SAC `transfer` from this contract → customer
//!
//! This contract IS custodial for the period between deposit and withdrawal.
//! The security audit must focus on this contract above all others.
//!
//! ## Access Control
//! - `initialize`        — once only, no auth
//! - `transfer_admin`    — admin only
//! - `create_vault`      — customer (vault owner) — they sign, they deposit
//! - `deposit`           — customer (vault owner) — they sign
//! - `debit_vault`       — admin only (Invoq metering service)
//! - `withdraw`          — customer (vault owner) — they sign
//! - `close_vault`       — customer OR admin
//! - `update_threshold`  — customer (vault owner)
//! - `get_vault`         — public, read-only
//! - `get_admin`         — public, read-only
//! - `get_usdc_sac`      — public, read-only

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractevent,
    Address, Env, Symbol, IntoVal,
    panic_with_error, log,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const LEDGERS_PER_YEAR: u32     = 6_307_200;
const PERSISTENT_TTL_THRESHOLD: u32 = LEDGERS_PER_YEAR;
const PERSISTENT_TTL_BUMP:      u32 = LEDGERS_PER_YEAR;

/// Minimum deposit / top-up: 0.10 USDC = 1_000_000 stroops
/// Prevents dust deposits that waste storage
const MIN_DEPOSIT_STROOPS: i128 = 1_000_000;

// ─── Error Codes ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // Initialisation
    AlreadyInitialized        = 1,
    NotInitialized            = 2,

    // Auth
    Unauthorized              = 10,

    // Vault lifecycle
    VaultAlreadyExists        = 20,
    VaultNotFound             = 21,

    // Financial
    DepositTooSmall           = 30,
    InsufficientVaultBalance  = 31,
    InvalidAmount             = 32,
    PaymentFailed             = 33,
    InvalidThreshold          = 34,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Contract admin address — instance storage
    Admin,
    /// USDC SAC address — instance storage, immutable after init
    UsdcSac,
    /// VaultRecord keyed by (customer, developer) — persistent storage
    ///
    /// A single customer can fund vaults for multiple developers.
    /// A single developer can have vaults from multiple customers.
    /// The pair is the unique key.
    Vault(Address, Address),
}

// ─── Data Structures ─────────────────────────────────────────────────────────

/// A single prepaid USDC vault for a (customer, developer) pair.
#[contracttype]
#[derive(Clone)]
pub struct VaultRecord {
    /// The customer wallet that owns this vault and can withdraw from it.
    pub customer: Address,

    /// The developer wallet whose API usage is paid from this vault.
    /// Debits go directly to this address — no intermediate escrow.
    pub developer: Address,

    /// Current vault balance in USDC stroops.
    /// Decremented by debit_vault, incremented by deposit.
    pub balance_usdc: i128,

    /// Cumulative total deposited since vault creation. Audit trail.
    pub total_deposited: i128,

    /// Cumulative total debited since vault creation. Audit trail.
    pub total_debited: i128,

    /// Balance below which a `VaultLowBalance` event fires.
    /// The Invoq backend listens for this event and sends a notification.
    /// 0 = no alert.
    pub low_balance_threshold: i128,

    /// If > 0, automatically top up by this amount when balance drops
    /// below `low_balance_threshold`. Requires the customer to have a
    /// pre-approved USDC SAC allowance >= this amount.
    /// 0 = no auto top-up.
    pub auto_topup_amount: i128,

    /// Unix timestamp when this vault was created.
    pub created_at: u64,
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct VaultCreated {
    #[topic] pub customer:  Address,
    #[topic] pub developer: Address,
    pub initial_balance: i128,
}

#[contractevent]
pub struct VaultDeposited {
    #[topic] pub customer:    Address,
    #[topic] pub developer:   Address,
    pub amount:       i128,
    pub new_balance:  i128,
}

#[contractevent]
pub struct VaultDebited {
    #[topic] pub customer:        Address,
    #[topic] pub developer:       Address,
    pub amount:           i128,
    pub new_balance:      i128,
    pub usage_description: soroban_sdk::String,
}

#[contractevent]
pub struct VaultWithdrawn {
    #[topic] pub customer:   Address,
    #[topic] pub developer:  Address,
    pub amount:      i128,
    pub new_balance: i128,
}

#[contractevent]
pub struct VaultClosed {
    #[topic] pub customer:  Address,
    #[topic] pub developer: Address,
    pub refunded:   i128,
}

#[contractevent]
pub struct VaultLowBalance {
    #[topic] pub customer:   Address,
    #[topic] pub developer:  Address,
    pub balance:     i128,
    pub threshold:   i128,
}

#[contractevent]
pub struct VaultBalanceRestored {
    #[topic] pub customer:  Address,
    #[topic] pub developer: Address,
    pub new_balance: i128,
}

#[contractevent]
pub struct VaultThresholdUpdated {
    #[topic] pub customer:             Address,
    #[topic] pub developer:            Address,
    pub new_threshold:         i128,
    pub new_auto_topup_amount: i128,
}

#[contractevent]
pub struct AutoTopUpExecuted {
    #[topic] pub customer:   Address,
    #[topic] pub developer:  Address,
    pub amount:      i128,
    pub new_balance: i128,
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

fn require_customer(env: &Env, caller: &Address, customer: &Address) {
    if *caller != *customer {
        panic_with_error!(env, Error::Unauthorized);
    }
    caller.require_auth();
}

fn require_customer_or_admin(env: &Env, caller: &Address, customer: &Address) {
    let admin = load_admin(env);
    if *caller != *customer && *caller != admin {
        panic_with_error!(env, Error::Unauthorized);
    }
    caller.require_auth();
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

fn vault_key(customer: &Address, developer: &Address) -> DataKey {
    DataKey::Vault(customer.clone(), developer.clone())
}

fn load_vault(env: &Env, customer: &Address, developer: &Address) -> VaultRecord {
    let key = vault_key(customer, developer);
    let vault = env
        .storage()
        .persistent()
        .get::<DataKey, VaultRecord>(&key)
        .unwrap_or_else(|| panic_with_error!(env, Error::VaultNotFound));
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    vault
}

fn try_load_vault(env: &Env, customer: &Address, developer: &Address) -> Option<VaultRecord> {
    let key = vault_key(customer, developer);
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, VaultRecord>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
    }
    result
}

fn store_vault(env: &Env, vault: &VaultRecord) {
    let key = vault_key(&vault.customer, &vault.developer);
    env.storage().persistent().set(&key, vault);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_BUMP);
}

fn remove_vault(env: &Env, customer: &Address, developer: &Address) {
    let key = vault_key(customer, developer);
    env.storage().persistent().remove(&key);
}

fn load_usdc_sac(env: &Env) -> Address {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::UsdcSac)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

// ─── SAC Transfer Helpers ─────────────────────────────────────────────────────
//
// Three distinct transfer directions — each is a separate helper to make
// intent explicit and avoid mixing up from/to at the call site.

/// Transfer USDC from `from` to this contract (deposit).
///
/// Uses SAC `transfer` — the customer must sign this transaction.
/// `from` is the transaction signer so Soroban's auth engine handles it.
fn sac_transfer_in(
    env: &Env,
    usdc_sac: &Address,
    from: &Address,
    amount: i128,
) -> bool {
    let contract = env.current_contract_address();
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        usdc_sac,
        &Symbol::new(env, "transfer"),
        soroban_sdk::vec![
            env,
            from.into_val(env),
            contract.into_val(env),
            amount.into_val(env),
        ],
    );
    matches!(result, Ok(Ok(_)))
}

/// Transfer USDC from this contract to `to` (debit to developer / refund to customer).
///
/// Uses SAC `transfer` — this contract is the sender, no customer auth needed.
/// The contract itself authorises this transfer via Soroban's contract auth context.
fn sac_transfer_out(
    env: &Env,
    usdc_sac: &Address,
    to: &Address,
    amount: i128,
) -> bool {
    let contract = env.current_contract_address();
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        usdc_sac,
        &Symbol::new(env, "transfer"),
        soroban_sdk::vec![
            env,
            contract.into_val(env),
            to.into_val(env),
            amount.into_val(env),
        ],
    );
    matches!(result, Ok(Ok(_)))
}

/// Attempt auto top-up for a vault that has fallen below its threshold.
///
/// Uses SAC `transfer_from` with this contract as spender.
/// Customer must have pre-approved this contract as a spender.
/// Returns true if top-up succeeded, false if it failed (no allowance, etc.).
/// Failure is silent — auto top-up failing does NOT block the triggering debit.
fn try_auto_topup(
    env: &Env,
    usdc_sac: &Address,
    vault: &mut VaultRecord,
) -> bool {
    if vault.auto_topup_amount <= 0 {
        return false;
    }

    let contract = env.current_contract_address();
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        usdc_sac,
        &Symbol::new(env, "transfer_from"),
        soroban_sdk::vec![
            env,
            contract.into_val(env),          // spender = this contract
            vault.customer.into_val(env),    // from = customer
            contract.into_val(env),          // to = this contract (vault)
            vault.auto_topup_amount.into_val(env),
        ],
    );

    if matches!(result, Ok(Ok(_))) {
        let amount         = vault.auto_topup_amount;
        vault.balance_usdc = vault.balance_usdc.saturating_add(amount);
        vault.total_deposited = vault.total_deposited.saturating_add(amount);
        true
    } else {
        false
    }
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowVault;

#[contractimpl]
impl EscrowVault {

    // ═════════════════════════════════════════════════════════════════════════
    // INITIALISATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Initialises the EscrowVault contract.
    ///
    /// Must be called once immediately after deployment.
    /// EscrowVault is standalone — no dependency on other Invoq contracts.
    ///
    /// # Arguments
    /// * `admin`    — Contract admin (Invoq backend metering service).
    /// * `usdc_sac` — Stellar USDC SAC address. Immutable after init.
    pub fn initialize(env: Env, admin: Address, usdc_sac: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin,   &admin);
        env.storage().instance().set(&DataKey::UsdcSac, &usdc_sac);
        log!(&env, "EscrowVault initialized. admin={}", admin);
    }

    /// Transfers admin authority to a new address. Admin only.
    pub fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        require_admin(&env, &caller);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        log!(&env, "EscrowVault admin transferred to {}", new_admin);
    }

    /// Returns the admin address.
    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    /// Returns the USDC SAC address.
    pub fn get_usdc_sac(env: Env) -> Address {
        load_usdc_sac(&env)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VAULT LIFECYCLE
    // ═════════════════════════════════════════════════════════════════════════

    /// Creates a new vault and deposits the initial amount.
    ///
    /// The customer (vault owner) must sign this transaction. The initial
    /// deposit is transferred from the customer's wallet to this contract
    /// via SAC `transfer` in the same transaction — atomic with vault creation.
    /// If the transfer fails, no vault is created.
    ///
    /// # Arguments
    /// * `caller`               — Must be the customer. Must sign the tx.
    /// * `customer`             — The vault owner's wallet address.
    /// * `developer`            — The developer whose API this vault funds.
    /// * `initial_deposit`      — Initial USDC in stroops. Min 1_000_000 (0.10 USDC).
    /// * `low_balance_threshold`— Alert threshold in stroops. 0 = no alert.
    /// * `auto_topup_amount`    — Auto top-up amount. 0 = disabled.
    ///
    /// # Returns
    /// The newly created `VaultRecord`.
    ///
    /// # Errors
    /// * `Unauthorized`       — caller is not the customer.
    /// * `VaultAlreadyExists` — vault already exists for this pair.
    /// * `DepositTooSmall`    — initial_deposit < 1_000_000 stroops.
    /// * `PaymentFailed`      — SAC transfer failed (no balance / allowance).
    pub fn create_vault(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
        initial_deposit: i128,
        low_balance_threshold: i128,
        auto_topup_amount: i128,
    ) -> VaultRecord {
        require_customer(&env, &caller, &customer);

        if try_load_vault(&env, &customer, &developer).is_some() {
            panic_with_error!(&env, Error::VaultAlreadyExists);
        }
        if initial_deposit < MIN_DEPOSIT_STROOPS {
            panic_with_error!(&env, Error::DepositTooSmall);
        }
        if low_balance_threshold < 0 || auto_topup_amount < 0 {
            panic_with_error!(&env, Error::InvalidThreshold);
        }

        // Transfer initial deposit from customer to this contract
        let usdc_sac = load_usdc_sac(&env);
        let ok = sac_transfer_in(&env, &usdc_sac, &customer, initial_deposit);
        if !ok {
            panic_with_error!(&env, Error::PaymentFailed);
        }

        let now = env.ledger().timestamp();

        let vault = VaultRecord {
            customer:              customer.clone(),
            developer:             developer.clone(),
            balance_usdc:          initial_deposit,
            total_deposited:       initial_deposit,
            total_debited:         0,
            low_balance_threshold: low_balance_threshold.max(0),
            auto_topup_amount:     auto_topup_amount.max(0),
            created_at:            now,
        };

        store_vault(&env, &vault);

        VaultCreated {
            customer:        customer.clone(),
            developer:       developer.clone(),
            initial_balance: initial_deposit,
        }
        .publish(&env);

        VaultDeposited {
            customer:    customer,
            developer:   developer,
            amount:      initial_deposit,
            new_balance: initial_deposit,
        }
        .publish(&env);

        vault
    }

    /// Deposits additional USDC into an existing vault.
    ///
    /// The customer must sign this transaction. Transfers `amount` from the
    /// customer's wallet to this contract. If the vault previously had a
    /// low-balance alert fired and the new balance is above the threshold,
    /// emits a `VaultBalanceRestored` event.
    ///
    /// # Arguments
    /// * `caller`    — Must be the customer. Must sign the tx.
    /// * `customer`  — Vault owner address.
    /// * `developer` — Identifies which vault to deposit into.
    /// * `amount`    — Deposit amount in USDC stroops. Min 1_000_000.
    ///
    /// # Returns
    /// The new vault balance after deposit.
    pub fn deposit(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
        amount: i128,
    ) -> i128 {
        require_customer(&env, &caller, &customer);

        if amount < MIN_DEPOSIT_STROOPS {
            panic_with_error!(&env, Error::DepositTooSmall);
        }

        let mut vault = load_vault(&env, &customer, &developer);
        let was_below_threshold = vault.low_balance_threshold > 0
            && vault.balance_usdc < vault.low_balance_threshold;

        let usdc_sac = load_usdc_sac(&env);
        let ok = sac_transfer_in(&env, &usdc_sac, &customer, amount);
        if !ok {
            panic_with_error!(&env, Error::PaymentFailed);
        }

        vault.balance_usdc    = vault.balance_usdc.saturating_add(amount);
        vault.total_deposited = vault.total_deposited.saturating_add(amount);
        let new_balance = vault.balance_usdc;

        store_vault(&env, &vault);

        VaultDeposited {
            customer:    customer.clone(),
            developer:   developer.clone(),
            amount,
            new_balance,
        }
        .publish(&env);

        // If the vault was previously below threshold and is now above it, notify
        if was_below_threshold
            && vault.low_balance_threshold > 0
            && new_balance >= vault.low_balance_threshold
        {
            VaultBalanceRestored {
                customer:    customer,
                developer:   developer,
                new_balance,
            }
            .publish(&env);
        }

        new_balance
    }

    // ═════════════════════════════════════════════════════════════════════════
    // METERING — core revenue flow
    // ═════════════════════════════════════════════════════════════════════════

    /// Debits a usage amount from a vault and transfers it to the developer.
    ///
    /// This is the core revenue distribution function. Called by the Invoq
    /// metering service (admin) after confirming API usage. Funds flow directly
    /// from the vault (held in this contract) to the developer's wallet — no
    /// intermediate hold, no batching, instant settlement on Stellar.
    ///
    /// After the debit:
    /// - If `new_balance < low_balance_threshold`, emits `VaultLowBalance`.
    /// - If `auto_topup_amount > 0` AND balance is below threshold, attempts
    ///   automatic top-up via SAC `transfer_from`. Top-up failure is silent —
    ///   it does NOT reverse the debit or block the current call.
    ///
    /// # Arguments
    /// * `caller`            — Must be admin.
    /// * `customer`          — The vault owner being charged.
    /// * `developer`         — The developer receiving payment.
    /// * `amount`            — Amount to debit in USDC stroops. Must be > 0.
    /// * `usage_description` — Human-readable usage label for audit trail.
    ///                         E.g. "1000 tokens", "50 API calls". Max 128 bytes.
    ///
    /// # Returns
    /// The remaining vault balance after debit.
    ///
    /// # Errors
    /// * `Unauthorized`             — caller is not admin.
    /// * `VaultNotFound`            — no vault for this pair.
    /// * `InvalidAmount`            — amount is 0 or negative.
    /// * `InsufficientVaultBalance` — debit would take balance below 0.
    /// * `PaymentFailed`            — SAC transfer to developer failed.
    pub fn debit_vault(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
        amount: i128,
        usage_description: soroban_sdk::String,
    ) -> i128 {
        require_admin(&env, &caller);

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let mut vault = load_vault(&env, &customer, &developer);

        if vault.balance_usdc < amount {
            panic_with_error!(&env, Error::InsufficientVaultBalance);
        }

        // Transfer to developer BEFORE updating state.
        // If the SAC transfer fails, we do not decrement the balance.
        // This is safe because we verified balance >= amount above.
        let usdc_sac = load_usdc_sac(&env);
        let ok = sac_transfer_out(&env, &usdc_sac, &developer, amount);
        if !ok {
            panic_with_error!(&env, Error::PaymentFailed);
        }

        // Update state after confirmed transfer
        vault.balance_usdc  = vault.balance_usdc.saturating_sub(amount);
        vault.total_debited = vault.total_debited.saturating_add(amount);
        let new_balance = vault.balance_usdc;

        // Check if auto top-up should trigger BEFORE storing,
        // so the store captures the updated balance if top-up succeeds
        let threshold_breached = vault.low_balance_threshold > 0
            && new_balance < vault.low_balance_threshold;

        if threshold_breached && vault.auto_topup_amount > 0 {
            // Attempt auto top-up — updates vault.balance_usdc in-place if successful
            let topup_amount = vault.auto_topup_amount;
            let succeeded    = try_auto_topup(&env, &usdc_sac, &mut vault);

            if succeeded {
                AutoTopUpExecuted {
                    customer:    customer.clone(),
                    developer:   developer.clone(),
                    amount:      topup_amount,
                    new_balance: vault.balance_usdc,
                }
                .publish(&env);
            }
        }

        // Persist the final state (may include auto top-up adjustment)
        store_vault(&env, &vault);

        // Emit debit event (always, regardless of top-up result)
        VaultDebited {
            customer:          customer.clone(),
            developer:         developer.clone(),
            amount,
            new_balance,      // the balance AFTER debit, BEFORE any top-up
            usage_description,
        }
        .publish(&env);

        // Emit low-balance alert if threshold was breached
        // (emit after debit event so listeners see the debit first)
        if threshold_breached {
            VaultLowBalance {
                customer:  customer,
                developer: developer,
                balance:   new_balance,
                threshold: vault.low_balance_threshold,
            }
            .publish(&env);
        }

        vault.balance_usdc // return post-topup balance (most useful to caller)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // WITHDRAWAL — customer can always get their money back
    // ═════════════════════════════════════════════════════════════════════════

    /// Withdraws USDC from a vault back to the customer's wallet.
    ///
    /// The customer can withdraw any amount up to the current balance at any
    /// time, for any reason. There is no lock-up period, cooldown, or fee.
    /// Funds are returned via SAC `transfer` from this contract to the customer.
    ///
    /// # Arguments
    /// * `caller`    — Must be the customer (vault owner). Must sign.
    /// * `customer`  — Vault owner address.
    /// * `developer` — Identifies which vault to withdraw from.
    /// * `amount`    — Withdrawal amount in stroops. Must be > 0 and <= balance.
    ///
    /// # Returns
    /// The remaining vault balance after withdrawal.
    pub fn withdraw(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
        amount: i128,
    ) -> i128 {
        require_customer(&env, &caller, &customer);

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let mut vault = load_vault(&env, &customer, &developer);

        if vault.balance_usdc < amount {
            panic_with_error!(&env, Error::InsufficientVaultBalance);
        }

        // Transfer to customer BEFORE updating state (same pattern as debit)
        let usdc_sac = load_usdc_sac(&env);
        let ok = sac_transfer_out(&env, &usdc_sac, &customer, amount);
        if !ok {
            panic_with_error!(&env, Error::PaymentFailed);
        }

        vault.balance_usdc = vault.balance_usdc.saturating_sub(amount);
        let new_balance    = vault.balance_usdc;

        store_vault(&env, &vault);

        VaultWithdrawn {
            customer:    customer,
            developer:   developer,
            amount,
            new_balance,
        }
        .publish(&env);

        new_balance
    }

    /// Closes a vault permanently and refunds the entire remaining balance.
    ///
    /// If the balance is 0, closes without any transfer.
    /// After closing, `create_vault` can be called again for the same pair.
    ///
    /// Auth: customer OR admin (admin can close for account termination).
    ///
    /// # Returns
    /// Amount refunded to the customer (0 if vault was already empty).
    pub fn close_vault(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
    ) -> i128 {
        require_customer_or_admin(&env, &caller, &customer);

        let vault = load_vault(&env, &customer, &developer);
        let refund = vault.balance_usdc;

        // Refund remaining balance if non-zero
        if refund > 0 {
            let usdc_sac = load_usdc_sac(&env);
            let ok = sac_transfer_out(&env, &usdc_sac, &customer, refund);
            if !ok {
                panic_with_error!(&env, Error::PaymentFailed);
            }
        }

        // Remove from storage — vault is gone
        remove_vault(&env, &customer, &developer);

        VaultClosed {
            customer:  customer,
            developer: developer,
            refunded:  refund,
        }
        .publish(&env);

        refund
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═════════════════════════════════════════════════════════════════════════

    /// Updates the low-balance threshold and auto top-up configuration.
    ///
    /// Customer only. Changes take effect immediately.
    /// Next debit that drops balance below new threshold fires the alert.
    ///
    /// # Arguments
    /// * `caller`             — Must be the customer.
    /// * `customer`           — Vault owner.
    /// * `developer`          — Identifies the vault.
    /// * `new_threshold`      — New alert threshold in stroops. 0 = no alert.
    /// * `new_auto_topup`     — New top-up amount. 0 = disabled.
    pub fn update_threshold(
        env: Env,
        caller: Address,
        customer: Address,
        developer: Address,
        new_threshold: i128,
        new_auto_topup: i128,
    ) {
        require_customer(&env, &caller, &customer);

        if new_threshold < 0 || new_auto_topup < 0 {
            panic_with_error!(&env, Error::InvalidThreshold);
        }

        let mut vault = load_vault(&env, &customer, &developer);
        vault.low_balance_threshold = new_threshold;
        vault.auto_topup_amount     = new_auto_topup;

        store_vault(&env, &vault);

        VaultThresholdUpdated {
            customer:              customer,
            developer:             developer,
            new_threshold,
            new_auto_topup_amount: new_auto_topup,
        }
        .publish(&env);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // READ FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /// Returns the full VaultRecord for a (customer, developer) pair, or None.
    pub fn get_vault(
        env: Env,
        customer: Address,
        developer: Address,
    ) -> Option<VaultRecord> {
        try_load_vault(&env, &customer, &developer)
    }

    /// Returns whether a vault exists for the given pair.
    pub fn vault_exists(
        env: Env,
        customer: Address,
        developer: Address,
    ) -> bool {
        try_load_vault(&env, &customer, &developer).is_some()
    }

    /// Returns the current USDC balance for a vault, or 0 if not found.
    pub fn get_balance(
        env: Env,
        customer: Address,
        developer: Address,
    ) -> i128 {
        try_load_vault(&env, &customer, &developer)
            .map(|v| v.balance_usdc)
            .unwrap_or(0)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        Env, String,
    };

    // ── Setup helpers ─────────────────────────────────────────────────────────

    struct TestCtx {
        env:       Env,
        client:    EscrowVaultClient<'static>,
        admin:     Address,
        usdc_sac:  Address,
        customer:  Address,
        developer: Address,
    }

    fn setup() -> TestCtx {
        let env = Env::default();
        env.mock_all_auths();

        // Set a realistic ledger timestamp so day_number calculations work
        env.ledger().set(LedgerInfo {
            timestamp:          1_700_000_000,
            protocol_version:   22,
            sequence_number:    1,
            network_id:         Default::default(),
            base_reserve:       10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl:      LEDGERS_PER_YEAR * 2,
        });

        let contract_id = env.register_contract(None, EscrowVault);
        let client      = EscrowVaultClient::new(&env, &contract_id);
        let admin       = Address::generate(&env);
        let usdc_sac    = Address::generate(&env);
        let customer    = Address::generate(&env);
        let developer   = Address::generate(&env);

        client.initialize(&admin, &usdc_sac);

        TestCtx { env, client, admin, usdc_sac, customer, developer }
    }

    fn desc(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    #[test]
    fn test_init_once() {
        let ctx = setup();
        assert!(ctx.client.try_initialize(&ctx.admin, &ctx.usdc_sac).is_err());
    }

    #[test]
    fn test_get_admin() {
        let ctx = setup();
        assert_eq!(ctx.client.get_admin(), ctx.admin);
    }

    #[test]
    fn test_get_usdc_sac() {
        let ctx = setup();
        assert_eq!(ctx.client.get_usdc_sac(), ctx.usdc_sac);
    }

    // ── Vault creation ────────────────────────────────────────────────────────

    #[test]
    fn test_create_vault_stores_record() {
        let ctx = setup();
        let vault = ctx.client.create_vault(
            &ctx.customer,
            &ctx.customer,
            &ctx.developer,
            &50_000_000i128,   // 5 USDC
            &10_000_000i128,   // 1 USDC threshold
            &0i128,            // no auto top-up
        );
        assert_eq!(vault.customer,        ctx.customer);
        assert_eq!(vault.developer,       ctx.developer);
        assert_eq!(vault.balance_usdc,    50_000_000i128);
        assert_eq!(vault.total_deposited, 50_000_000i128);
        assert_eq!(vault.total_debited,   0i128);
        assert!(vault.created_at > 0);
    }

    #[test]
    fn test_create_vault_duplicate_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        ).is_err());
    }

    #[test]
    fn test_create_vault_deposit_too_small_rejected() {
        let ctx = setup();
        assert!(ctx.client.try_create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &500_000i128, // below 1_000_000 minimum
            &0i128, &0i128,
        ).is_err());
    }

    #[test]
    fn test_vault_exists_after_creation() {
        let ctx = setup();
        assert!(!ctx.client.vault_exists(&ctx.customer, &ctx.developer));
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.vault_exists(&ctx.customer, &ctx.developer));
    }

    // ── deposit ───────────────────────────────────────────────────────────────

    #[test]
    fn test_deposit_increases_balance() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );

        let new_balance = ctx.client.deposit(
            &ctx.customer, &ctx.customer, &ctx.developer, &20_000_000i128,
        );
        assert_eq!(new_balance, 70_000_000i128);

        let vault = ctx.client.get_vault(&ctx.customer, &ctx.developer).unwrap();
        assert_eq!(vault.balance_usdc,    70_000_000i128);
        assert_eq!(vault.total_deposited, 70_000_000i128);
    }

    #[test]
    fn test_deposit_too_small_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_deposit(
            &ctx.customer, &ctx.customer, &ctx.developer, &500_000i128,
        ).is_err());
    }

    #[test]
    fn test_deposit_to_nonexistent_vault_rejected() {
        let ctx     = setup();
        let other   = Address::generate(&ctx.env);
        assert!(ctx.client.try_deposit(
            &ctx.customer, &ctx.customer, &other, &10_000_000i128,
        ).is_err());
    }

    // ── debit_vault ───────────────────────────────────────────────────────────

    #[test]
    fn test_debit_decreases_balance_and_tracks_total() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &100_000_000i128, &0i128, &0i128,
        );

        let after = ctx.client.debit_vault(
            &ctx.admin, &ctx.customer, &ctx.developer,
            &30_000_000i128,
            &desc(&ctx.env, "300 API calls"),
        );
        assert_eq!(after, 70_000_000i128);

        let vault = ctx.client.get_vault(&ctx.customer, &ctx.developer).unwrap();
        assert_eq!(vault.balance_usdc,  70_000_000i128);
        assert_eq!(vault.total_debited, 30_000_000i128);
    }

    #[test]
    fn test_debit_zero_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_debit_vault(
            &ctx.admin, &ctx.customer, &ctx.developer,
            &0i128, &desc(&ctx.env, "zero"),
        ).is_err());
    }

    #[test]
    fn test_debit_over_balance_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_debit_vault(
            &ctx.admin, &ctx.customer, &ctx.developer,
            &20_000_000i128,  // more than balance
            &desc(&ctx.env, "over"),
        ).is_err());
    }

    #[test]
    fn test_debit_by_non_admin_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );
        // customer tries to call debit — must fail
        assert!(ctx.client.try_debit_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &desc(&ctx.env, "hack"),
        ).is_err());
    }

    #[test]
    fn test_sequential_debits_track_correctly() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &100_000_000i128, &0i128, &0i128,
        );

        ctx.client.debit_vault(&ctx.admin, &ctx.customer, &ctx.developer,
            &10_000_000i128, &desc(&ctx.env, "batch 1"));
        ctx.client.debit_vault(&ctx.admin, &ctx.customer, &ctx.developer,
            &25_000_000i128, &desc(&ctx.env, "batch 2"));
        ctx.client.debit_vault(&ctx.admin, &ctx.customer, &ctx.developer,
            &15_000_000i128, &desc(&ctx.env, "batch 3"));

        let vault = ctx.client.get_vault(&ctx.customer, &ctx.developer).unwrap();
        assert_eq!(vault.balance_usdc,  50_000_000i128);
        assert_eq!(vault.total_debited, 50_000_000i128);
    }

    // ── withdraw ──────────────────────────────────────────────────────────────

    #[test]
    fn test_withdraw_decreases_balance() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &100_000_000i128, &0i128, &0i128,
        );

        let after = ctx.client.withdraw(
            &ctx.customer, &ctx.customer, &ctx.developer, &40_000_000i128,
        );
        assert_eq!(after, 60_000_000i128);

        let vault = ctx.client.get_vault(&ctx.customer, &ctx.developer).unwrap();
        assert_eq!(vault.balance_usdc, 60_000_000i128);
    }

    #[test]
    fn test_withdraw_full_balance() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );

        let after = ctx.client.withdraw(
            &ctx.customer, &ctx.customer, &ctx.developer, &50_000_000i128,
        );
        assert_eq!(after, 0i128);
    }

    #[test]
    fn test_withdraw_over_balance_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_withdraw(
            &ctx.customer, &ctx.customer, &ctx.developer, &20_000_000i128,
        ).is_err());
    }

    #[test]
    fn test_withdraw_by_non_owner_rejected() {
        let ctx      = setup();
        let attacker = Address::generate(&ctx.env);
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_withdraw(
            &attacker, &ctx.customer, &ctx.developer, &10_000_000i128,
        ).is_err());
    }

    // ── close_vault ───────────────────────────────────────────────────────────

    #[test]
    fn test_close_vault_refunds_balance() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &80_000_000i128, &0i128, &0i128,
        );

        let refunded = ctx.client.close_vault(&ctx.customer, &ctx.customer, &ctx.developer);
        assert_eq!(refunded, 80_000_000i128);
        assert!(!ctx.client.vault_exists(&ctx.customer, &ctx.developer));
    }

    #[test]
    fn test_close_empty_vault_returns_zero() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        // Withdraw everything first
        ctx.client.withdraw(
            &ctx.customer, &ctx.customer, &ctx.developer, &10_000_000i128,
        );

        let refunded = ctx.client.close_vault(&ctx.customer, &ctx.customer, &ctx.developer);
        assert_eq!(refunded, 0i128);
        assert!(!ctx.client.vault_exists(&ctx.customer, &ctx.developer));
    }

    #[test]
    fn test_close_vault_by_admin() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &20_000_000i128, &0i128, &0i128,
        );
        // Admin closes on behalf of customer
        let refunded = ctx.client.close_vault(&ctx.admin, &ctx.customer, &ctx.developer);
        assert_eq!(refunded, 20_000_000i128);
    }

    #[test]
    fn test_close_vault_then_recreate() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        ctx.client.close_vault(&ctx.customer, &ctx.customer, &ctx.developer);

        // Should be able to create a fresh vault after closing
        let vault = ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &20_000_000i128, &0i128, &0i128,
        );
        assert_eq!(vault.balance_usdc, 20_000_000i128);
        assert_eq!(vault.total_deposited, 20_000_000i128);
        assert_eq!(vault.total_debited, 0i128);
    }

    // ── update_threshold ──────────────────────────────────────────────────────

    #[test]
    fn test_update_threshold_changes_values() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128,
            &DEFAULT_THRESHOLD_STROOPS,
            &0i128,
        );

        ctx.client.update_threshold(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &20_000_000i128, // new threshold
            &50_000_000i128, // enable auto top-up
        );

        let vault = ctx.client.get_vault(&ctx.customer, &ctx.developer).unwrap();
        assert_eq!(vault.low_balance_threshold, 20_000_000i128);
        assert_eq!(vault.auto_topup_amount,     50_000_000i128);
    }

    #[test]
    fn test_update_threshold_negative_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_update_threshold(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &-1i128, &0i128,
        ).is_err());
    }

    // ── get_balance ───────────────────────────────────────────────────────────

    #[test]
    fn test_get_balance_returns_current_balance() {
        let ctx = setup();
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 0i128);

        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &75_000_000i128, &0i128, &0i128,
        );
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 75_000_000i128);
    }

    // ── multiple vaults ───────────────────────────────────────────────────────

    #[test]
    fn test_one_customer_multiple_developers() {
        let ctx  = setup();
        let dev2 = Address::generate(&ctx.env);

        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &30_000_000i128, &0i128, &0i128,
        );
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &dev2,
            &50_000_000i128, &0i128, &0i128,
        );

        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 30_000_000i128);
        assert_eq!(ctx.client.get_balance(&ctx.customer, &dev2),          50_000_000i128);

        // Debit from dev1's vault should not affect dev2's vault
        ctx.client.debit_vault(
            &ctx.admin, &ctx.customer, &ctx.developer,
            &10_000_000i128, &desc(&ctx.env, "api"),
        );
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 20_000_000i128);
        assert_eq!(ctx.client.get_balance(&ctx.customer, &dev2),          50_000_000i128);
    }

    #[test]
    fn test_one_developer_multiple_customers() {
        let ctx   = setup();
        let cust2 = Address::generate(&ctx.env);

        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &40_000_000i128, &0i128, &0i128,
        );
        ctx.client.create_vault(
            &cust2, &cust2, &ctx.developer,
            &60_000_000i128, &0i128, &0i128,
        );

        // Each customer's vault is independent
        ctx.client.debit_vault(
            &ctx.admin, &cust2, &ctx.developer,
            &20_000_000i128, &desc(&ctx.env, "api"),
        );
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 40_000_000i128);
        assert_eq!(ctx.client.get_balance(&cust2, &ctx.developer),        40_000_000i128);
    }

    // ── low balance + auto top-up ─────────────────────────────────────────────

    #[test]
    fn test_low_balance_threshold_configuration() {
        let ctx = setup();
        let vault = ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &50_000_000i128,
            &20_000_000i128, // alert when below 2 USDC
            &0i128,
        );
        assert_eq!(vault.low_balance_threshold, 20_000_000i128);
        assert_eq!(vault.auto_topup_amount, 0i128);
    }

    #[test]
    fn test_zero_threshold_no_alert() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &5_000_000i128,
            &0i128,   // no threshold
            &0i128,
        );
        // Debit to nearly zero — should succeed without panic
        ctx.client.debit_vault(
            &ctx.admin, &ctx.customer, &ctx.developer,
            &4_000_000i128, &desc(&ctx.env, "api"),
        );
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 1_000_000i128);
    }

    // ── withdraw zero edge case ───────────────────────────────────────────────

    #[test]
    fn test_withdraw_zero_rejected() {
        let ctx = setup();
        ctx.client.create_vault(
            &ctx.customer, &ctx.customer, &ctx.developer,
            &10_000_000i128, &0i128, &0i128,
        );
        assert!(ctx.client.try_withdraw(
            &ctx.customer, &ctx.customer, &ctx.developer, &0i128,
        ).is_err());
    }

    // ── non-existent vault reads ──────────────────────────────────────────────

    #[test]
    fn test_get_vault_nonexistent_returns_none() {
        let ctx = setup();
        assert!(ctx.client.get_vault(&ctx.customer, &ctx.developer).is_none());
    }

    #[test]
    fn test_get_balance_nonexistent_returns_zero() {
        let ctx = setup();
        assert_eq!(ctx.client.get_balance(&ctx.customer, &ctx.developer), 0i128);
    }

    // ── admin transfer ────────────────────────────────────────────────────────

    #[test]
    fn test_transfer_admin() {
        let ctx      = setup();
        let new_admin = Address::generate(&ctx.env);
        ctx.client.transfer_admin(&ctx.admin, &new_admin);
        assert_eq!(ctx.client.get_admin(), new_admin);
    }

    #[test]
    fn test_transfer_admin_unauthorized_rejected() {
        let ctx      = setup();
        let attacker = Address::generate(&ctx.env);
        let new_admin = Address::generate(&ctx.env);
        assert!(ctx.client.try_transfer_admin(&attacker, &new_admin).is_err());
    }
}