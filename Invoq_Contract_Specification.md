**Invoq**

Smart Contract Specification

*Production-Ready Soroban Contract Reference*

Version 1.0 · May 2026

Four Soroban Contracts · Rust / WASM · Stellar Mainnet

SubscriptionRegistry · BillingCycle · SpendPolicy · EscrowVault

**Overview**

*This document is the complete production contract specification for
Invoq\'s four Soroban smart contracts. It covers every public and
internal function, all parameters, return types, error codes, storage
layout, access control rules, and integration notes.*

Invoq\'s on-chain layer is composed of four independent Soroban
contracts deployed on Stellar mainnet. Each contract owns a distinct
domain of the billing system and communicates with others through
cross-contract calls via their deployed contract IDs. No contract holds
funds on behalf of users except the EscrowVault, which is explicitly
designed for that purpose.

  ---------------------- -------------------- -------------------------------------
  **Contract**           **Responsibility**   **Core job**

  SubscriptionRegistry   Plan & entitlement   Source of truth for all active
                         state                subscriptions and plan definitions.
                                              Queried on every API request to
                                              verify customer access.

  BillingCycle           Renewal automation   Tracks billing timestamps, triggers
                                              USDC debits via SAC on cycle close,
                                              manages grace periods and
                                              subscription state transitions.

  SpendPolicy            Budget & access      Enforces per-customer and per-agent
                         controls             spending limits, daily caps, and
                                              allowlists. Integrates with
                                              OpenZeppelin smart accounts.

  EscrowVault            Prepaid credit       Holds USDC deposits for usage-based
                         balances             customers. Decrements on metered API
                                              calls. Handles top-up, refund, and
                                              low-balance alerts.
  ---------------------- -------------------- -------------------------------------

> ⚠ All contracts must be deployed in sequence: SubscriptionRegistry
> first, then BillingCycle (requires Registry address), then SpendPolicy
> and EscrowVault independently. BillingCycle\'s initialiser requires
> the Registry contract ID at deploy time.

**Global conventions**

The following conventions apply across all four contracts:

-   **Admin authority:** All write operations that mutate plan or system
    state require the caller to be the contract admin, verified via
    env.invoker(). Admin is set at initialisation and can only be
    transferred by the current admin.

-   **Timestamps:** All timestamps use Unix epoch seconds as u64. Use
    env.ledger().timestamp() --- never accept timestamps from callers as
    they can be spoofed.

-   **USDC asset contract:** All USDC transfers use Stellar\'s native
    USDC SAC (Stellar Asset Contract). The SAC address is passed at
    initialisation and stored immutably. Never hardcoded.

-   **Reentrancy:** Soroban\'s execution model is single-threaded and
    does not require reentrancy guards, but state mutations must be
    committed before any cross-contract calls to maintain consistency.

-   **Storage TTL:** Persistent storage entries must set a TTL of at
    least 1 year (31,536,000 ledger seconds). Instance storage entries
    inherit the contract instance TTL. Bump TTL on every write.

-   **Events:** Every state-changing function emits a Soroban event.
    Event topics follow the format \[contract_name, function_name\]. All
    events are indexable.

**Contract 1 --- SubscriptionRegistry**

*The SubscriptionRegistry is the central source of truth for all
subscription state in Invoq. Every entitlement check, plan lookup, and
subscription status query resolves here.*

**Purpose and responsibilities**

The SubscriptionRegistry does two things: it stores plan definitions,
and it stores active subscription records that map customer addresses to
plans. It is the most-read contract in the system --- every inbound API
request to any Invoq-powered product triggers an entitlement check
against this contract. It must be optimised for read performance above
all else.

It does not handle payment. It does not trigger billing. It does not
hold funds. Its only job is to say, definitively, whether a given
customer wallet is entitled to access a given feature at the moment of
the query.

**Storage layout**

  ------------------ ------------ ----------------------------------------
  **Key**            **Storage    **Description**
                     type**       

  ADMIN              Instance     Address of the contract administrator.
                                  Set at init, mutable only by current
                                  admin.

  USDC_SAC           Instance     Address of the Stellar USDC Stellar
                                  Asset Contract. Immutable after init.

  PLAN:{plan_id}     Persistent   Full PlanConfig struct for a given plan
                                  ID. TTL bumped on every read.

  SUB:{customer}     Persistent   SubscriptionRecord struct keyed by
                                  customer wallet address.

  PLAN_COUNT         Instance     Monotonically incrementing u64 counter
                                  used to generate unique plan IDs.
  ------------------ ------------ ----------------------------------------

**Data structures**

**PLANCONFIG STRUCT**

  ------------------ --------------- ------------------------------------------
  **Field**          **Type**        **Description**

  plan_id            u64             Auto-incremented unique identifier for
                                     this plan.

  name               String          Human-readable plan name, e.g. \"Pro
                                     Monthly\". Max 64 chars.

  price_usdc         i128            Price in USDC stroops (1 USDC = 10,000,000
                                     stroops). Use i128 for SAC compatibility.

  interval_seconds   u64             Billing cycle length in seconds. 2592000 =
                                     30 days. 31536000 = 365 days.

  trial_seconds      u64             Free trial duration in seconds. 0 = no
                                     trial. Billing starts after trial expires.

  usage_limit        u64             Maximum usage units per billing cycle. 0 =
                                     unlimited.

  features           Vec\<String\>   List of feature flag strings this plan
                                     grants access to, e.g. \[\"api_access\",
                                     \"webhooks\"\].

  active             bool            If false, no new subscriptions can be
                                     created for this plan. Existing
                                     subscriptions continue.

  owner              Address         The developer wallet that created this
                                     plan and receives renewal payments.
  ------------------ --------------- ------------------------------------------

**SUBSCRIPTIONRECORD STRUCT**

  ---------------------- --------------- ------------------------------------------
  **Field**              **Type**        **Description**

  customer               Address         The customer\'s Stellar wallet address.

  plan_id                u64             ID of the plan the customer is subscribed
                                         to.

  status                 SubStatus       Enum: Active \| Trialing \| Paused \|
                                         GracePeriod \| Cancelled \| Expired.

  started_at             u64             Unix timestamp when subscription was first
                                         created.

  current_period_start   u64             Unix timestamp of the current billing
                                         period start.

  current_period_end     u64             Unix timestamp of the current billing
                                         period end. Also the next renewal
                                         timestamp.

  trial_end              Option\<u64\>   Unix timestamp when trial ends. None if no
                                         trial on this plan.

  cancel_at_period_end   bool            If true, subscription will be cancelled at
                                         current_period_end rather than renewed.

  usage_current          u64             Usage units consumed in the current
                                         billing period. Reset to 0 on renewal.
  ---------------------- --------------- ------------------------------------------

**Functions**

  -------------------- ----------------------------------------------------------
  **Function**         **initialize(env, admin, usdc_sac)**

  **Visibility**       Public --- callable once only. Subsequent calls panic.

  **Description**      Initialises the contract. Sets the admin address and the
                       USDC SAC address. Must be the first call after deployment.
                       The invoker does not need to be the admin --- the admin
                       address is set explicitly in the arguments, allowing
                       deployment scripts to set a multisig or DAO address as
                       admin.

  **PARAMETERS**       

  admin                Address --- The wallet address that will have admin
                       authority over this contract. Can be an account, multisig,
                       or another contract.

  usdc_sac             Address --- The deployed address of the Stellar USDC
                       Stellar Asset Contract. Used for all payment operations.
                       Immutable after init.

  **Returns**          ()

  **ERROR CODES**      

  AlreadyInitialized   Panics if the contract has already been initialised. Init
                       is strictly once.

  **Notes**            After calling initialize, call BillingCycle.initialize
                       with this contract\'s address as the registry_id
                       parameter.
  -------------------- ----------------------------------------------------------

  ------------------ ----------------------------------------------------------
  **Function**       **create_plan(env, name, price_usdc, interval_seconds,
                     trial_seconds, usage_limit, features)**

  **Visibility**     Public --- callable by any address (the plan owner is set
                     to the invoker).

  **Description**    Creates a new subscription plan and stores it in
                     persistent storage. The caller becomes the plan owner and
                     will receive all subscription revenue for this plan.
                     Returns the new plan\'s unique ID. Plan IDs are
                     auto-incremented and never reused.

  **PARAMETERS**     

  name               String --- Display name for the plan. Must be 1--64
                     characters. Cannot be empty.

  price_usdc         i128 --- Price per billing cycle in USDC stroops. Minimum
                     0 (for free plans). 1 USDC = 10,000,000 stroops.

  interval_seconds   u64 --- Billing cycle length in seconds. Minimum 86400 (1
                     day). Standard values: 2592000 (monthly), 31536000
                     (annual).

  trial_seconds      u64 --- Free trial duration in seconds. Pass 0 for no
                     trial. Trial period is subtracted from the first billing
                     cycle.

  usage_limit        u64 --- Maximum usage units per cycle. Pass 0 for
                     unlimited. Enforced by the metering system; not enforced
                     on-chain.

  features           Vec\<String\> --- List of feature flag strings this plan
                     grants. Used by check_entitlement. Max 32 feature flags
                     per plan.

  **Returns**        u64 --- the newly created plan_id

  **ERROR CODES**    

  InvalidPlanName    Name is empty or exceeds 64 characters.

  InvalidInterval    interval_seconds is less than 86400 (1 day).

  TooManyFeatures    features Vec contains more than 32 entries.

  **Notes**          Emits a plan_created event with the plan_id and owner.
                     Plans are immediately active after creation. Call
                     deactivate_plan to prevent new subscriptions without
                     deleting the plan definition.
  ------------------ ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **update_plan(env, plan_id, name, price_usdc, usage_limit,
                    features)**

  **Visibility**    Admin or plan owner only.

  **Description**   Updates mutable fields of an existing plan. The price_usdc
                    and usage_limit changes apply only to new billing cycles
                    --- existing subscribers are not affected until their next
                    renewal. Name and feature changes take effect immediately.
                    interval_seconds cannot be changed after plan creation.

  **PARAMETERS**    

  plan_id           u64 --- ID of the plan to update. Must exist and be owned
                    by the invoker.

  name              String --- New display name. Pass existing name to leave
                    unchanged.

  price_usdc        i128 --- New price in USDC stroops. Applies to renewals
                    after the update.

  usage_limit       u64 --- New usage limit. Pass 0 for unlimited. Applies
                    immediately to current period.

  features          Vec\<String\> --- New feature flag list. Replaces existing
                    features entirely.

  **Returns**       ()

  **ERROR CODES**   

  PlanNotFound      No plan exists with the given plan_id.

  Unauthorized      Invoker is neither admin nor the plan owner.

  **Notes**         Emits a plan_updated event. Existing subscriber
                    entitlements reflect the new feature list immediately
                    after update.
  ----------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **deactivate_plan(env, plan_id)**

  **Visibility**    Admin or plan owner only.

  **Description**   Marks a plan as inactive, preventing new subscriptions
                    from being created against it. All existing subscriptions
                    on this plan continue unaffected --- they renew, are
                    checked, and can be cancelled normally. Deactivation is
                    reversible via reactivate_plan.

  **PARAMETERS**    

  plan_id           u64 --- ID of the plan to deactivate.

  **Returns**       ()

  **ERROR CODES**   

  PlanNotFound      No plan exists with the given plan_id.

  Unauthorized      Invoker is neither admin nor the plan owner.

  AlreadyInactive   Plan is already inactive. No-op with error.

  **Notes**         Emits a plan_deactivated event. Use this instead of
                    deleting plans --- plan history must be preserved for
                    audit purposes.
  ----------------- ----------------------------------------------------------

  ------------------- ----------------------------------------------------------
  **Function**        **create_subscription(env, customer, plan_id)**

  **Visibility**      Admin only. Called by BillingCycle after successful
                      initial payment.

  **Description**     Creates a new SubscriptionRecord for a customer on a given
                      plan. Sets the initial status to Trialing if the plan has
                      a trial_seconds \> 0, otherwise sets to Active. Sets
                      current_period_start to now and current_period_end to
                      now + interval_seconds. This function is not called
                      directly by end users --- it is called by the BillingCycle
                      contract after confirming initial payment.

  **PARAMETERS**      

  customer            Address --- The customer\'s Stellar wallet address. Must
                      not already have an active subscription.

  plan_id             u64 --- ID of the plan to subscribe the customer to. Must
                      be active.

  **Returns**         SubscriptionRecord --- the newly created subscription

  **ERROR CODES**     

  PlanNotFound        No active plan exists with the given plan_id.

  PlanInactive        The plan exists but is deactivated.

  AlreadySubscribed   Customer already has a non-cancelled subscription record.

  Unauthorized        Invoker is not the contract admin.

  **Notes**           Emits a subscription_created event. The customer must have
                      previously authorised the USDC SAC allowance for the
                      BillingCycle contract to debit their wallet on renewal.
  ------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **check_entitlement(env, customer, feature)**

  **Visibility**    Public --- read-only. No auth required.

  **Description**   The most-called function in the entire system. Given a
                    customer wallet address and a feature flag string, returns
                    true if the customer has an active (or trialing)
                    subscription to a plan that includes that feature, and
                    false otherwise. This function is designed to be called
                    from the Invoq backend on every inbound API request --- it
                    must be fast. It reads from persistent storage with TTL
                    bump on hit.

  **PARAMETERS**    

  customer          Address --- The customer wallet address to check
                    entitlement for.

  feature           String --- The feature flag string to check, e.g.
                    \"api_access\", \"webhooks\", \"export\". Case-sensitive.

  **Returns**       bool --- true if entitled, false if not

  **Notes**         Never panics --- a customer with no subscription record
                    returns false. This is the safe default. Call
                    get_subscription to retrieve the full record when you need
                    more detail than a boolean.
  ----------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **get_subscription(env, customer)**

  **Visibility**    Public --- read-only. No auth required.

  **Description**   Returns the full SubscriptionRecord for a customer
                    address. Used by the Invoq backend to render subscription
                    status in the developer dashboard, by the BillingCycle
                    contract when computing renewal amounts, and by the
                    SpendPolicy contract when checking plan-level budget
                    rules.

  **PARAMETERS**    

  customer          Address --- The customer wallet address to retrieve the
                    subscription record for.

  **Returns**       Option\<SubscriptionRecord\> --- None if no record exists

  **Notes**         Returns None rather than panicking when no record exists.
                    Callers must handle the None case.
  ----------------- ----------------------------------------------------------

  ---------------------- ----------------------------------------------------------
  **Function**           **update_subscription_status(env, customer, status)**

  **Visibility**         Admin only. Called by BillingCycle exclusively.

  **Description**        Updates the status field of a customer\'s subscription
                         record. This is how BillingCycle signals state transitions
                         --- from Active to GracePeriod on payment failure, from
                         GracePeriod to Cancelled on grace period expiry, from
                         Trialing to Active on trial end, etc. Direct callers
                         outside of BillingCycle should never invoke this function.

  **PARAMETERS**         

  customer               Address --- The customer whose subscription status is
                         being updated.

  status                 SubStatus --- The new status. One of: Active \| Trialing
                         \| Paused \| GracePeriod \| Cancelled \| Expired.

  **Returns**            ()

  **ERROR CODES**        

  SubscriptionNotFound   No subscription record exists for this customer.

  Unauthorized           Invoker is not the contract admin.

  InvalidTransition      The requested status transition is not permitted (e.g.
                         Cancelled → Active).

  **Notes**              Emits a status_changed event with old_status and
                         new_status fields. The transition table:
                         Active→GracePeriod (payment failed), GracePeriod→Active
                         (payment recovered), GracePeriod→Cancelled (grace
                         expired), Trialing→Active (trial ended), Active→Paused
                         (explicit pause), Paused→Active (resume), Active→Cancelled
                         (explicit cancel).
  ---------------------- ----------------------------------------------------------

  ---------------------- ----------------------------------------------------------
  **Function**           **renew_subscription(env, customer, new_period_start,
                         new_period_end)**

  **Visibility**         Admin only. Called by BillingCycle after successful
                         renewal payment.

  **Description**        Advances the billing period timestamps for a customer\'s
                         subscription after a successful renewal payment. Resets
                         usage_current to 0. If the subscription was in
                         GracePeriod, transitions it back to Active. This function
                         must only be called after the BillingCycle has confirmed
                         the USDC SAC transfer succeeded.

  **PARAMETERS**         

  customer               Address --- The customer whose subscription is being
                         renewed.

  new_period_start       u64 --- Unix timestamp for the start of the new billing
                         period.

  new_period_end         u64 --- Unix timestamp for the end of the new billing
                         period (next renewal date).

  **Returns**            ()

  **ERROR CODES**        

  SubscriptionNotFound   No subscription record exists for this customer.

  InvalidPeriod          new_period_end is not greater than new_period_start.

  Unauthorized           Invoker is not the contract admin.

  **Notes**              Emits a subscription_renewed event with plan_id, customer,
                         amount, and new_period_end. Usage reset is atomic with the
                         period advance.
  ---------------------- ----------------------------------------------------------

  ---------------------- ----------------------------------------------------------
  **Function**           **cancel_subscription(env, customer, immediate)**

  **Visibility**         Admin or the customer themselves.

  **Description**        Cancels a customer\'s subscription. If immediate is false,
                         sets cancel_at_period_end to true and the subscription
                         remains active until current_period_end --- the standard
                         end-of-period cancellation. If immediate is true, sets
                         status to Cancelled immediately with no refund unless the
                         caller is admin (admin cancellation can trigger an
                         EscrowVault refund separately).

  **PARAMETERS**         

  customer               Address --- The customer whose subscription is being
                         cancelled.

  immediate              bool --- If true, cancels immediately. If false, cancels
                         at end of current billing period.

  **Returns**            ()

  **ERROR CODES**        

  SubscriptionNotFound   No subscription record exists for this customer.

  AlreadyCancelled       Subscription is already in Cancelled status.

  Unauthorized           Invoker is neither admin nor the customer themselves.

  **Notes**              Emits a subscription_cancelled event with effective_at
                         timestamp. When cancel_at_period_end is set,
                         check_entitlement continues to return true until
                         current_period_end. BillingCycle will not renew
                         subscriptions where cancel_at_period_end is true.
  ---------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **get_plan(env, plan_id)**

  **Visibility**    Public --- read-only. No auth required.

  **Description**   Returns the full PlanConfig struct for a given plan ID.
                    Used by the dashboard, BillingCycle for renewal amount
                    calculations, and any external party verifying plan terms.

  **PARAMETERS**    

  plan_id           u64 --- The plan ID to retrieve.

  **Returns**       Option\<PlanConfig\> --- None if plan does not exist

  **Notes**         Bumps the storage TTL on read to prevent plan configs from
                    expiring while subscriptions are active.
  ----------------- ----------------------------------------------------------

  ----------------------- ----------------------------------------------------------
  **Function**            **increment_usage(env, customer, units)**

  **Visibility**          Admin only. Called by the Invoq backend metering service.

  **Description**         Increments the usage_current counter for a customer\'s
                          subscription by the given number of units. Does not
                          enforce limits on-chain --- limit enforcement is handled
                          by the Invoq API layer before this call is made. The
                          on-chain counter is the auditable source of truth for
                          usage billing disputes.

  **PARAMETERS**          

  customer                Address --- The customer whose usage counter is being
                          incremented.

  units                   u64 --- Number of usage units to add. Minimum 1.

  **Returns**             u64 --- the new total usage_current for this period

  **ERROR CODES**         

  SubscriptionNotFound    No active subscription for this customer.

  SubscriptionNotActive   Subscription status is not Active or Trialing.

  **Notes**               Emits a usage_recorded event with customer, plan_id,
                          units, and new_total. Batching: the API layer should batch
                          usage records and call this once per N requests rather
                          than once per request.
  ----------------------- ----------------------------------------------------------

**Contract 2 --- BillingCycle**

*BillingCycle is the automation engine of Invoq. It processes
subscription renewals, handles payment failures and grace periods, and
orchestrates all USDC transfers via the Stellar Asset Contract.*

**Purpose and responsibilities**

BillingCycle owns the renewal lifecycle. It is the only contract
authorised to trigger USDC debits from customer wallets. It calls
SubscriptionRegistry to read subscription state, executes the SAC
transfer, then calls back into SubscriptionRegistry to advance the
billing period or update the subscription status based on whether the
payment succeeded or failed.

The Invoq backend calls BillingCycle\'s process_renewals function via an
off-chain cron job that runs every 60 seconds. BillingCycle checks each
subscription due for renewal and processes it atomically. All logic is
deterministic --- the same inputs always produce the same outputs.

> ⚠ BillingCycle holds no funds. It only routes USDC transfers between
> the customer\'s wallet and the plan owner\'s wallet. The customer must
> have pre-authorised the USDC SAC allowance for BillingCycle\'s
> contract address.

**Storage layout**

  -------------------------- ------------ ---------------------------------------
  **Key**                    **Storage    **Description**
                             type**       

  ADMIN                      Instance     Contract admin address.

  REGISTRY_ID                Instance     Address of the SubscriptionRegistry
                                          contract. Set at init, immutable.

  USDC_SAC                   Instance     Address of the USDC Stellar Asset
                                          Contract.

  GRACE_PERIOD               Instance     Grace period duration in seconds.
                                          Default: 259200 (3 days). Configurable
                                          by admin.

  RENEWAL_QUEUE:{customer}   Persistent   Queued renewal record for a customer.
                                          Written when subscription enters
                                          GracePeriod.

  LAST_PROCESSED             Instance     Unix timestamp of the last
                                          process_renewals execution. Used for
                                          deduplication.
  -------------------------- ------------ ---------------------------------------

**Functions**

  ---------------------- ----------------------------------------------------------
  **Function**           **initialize(env, admin, registry_id, usdc_sac,
                         grace_period_seconds)**

  **Visibility**         Public --- callable once only.

  **Description**        Initialises the BillingCycle contract. Requires the
                         already-deployed SubscriptionRegistry contract address,
                         which is stored as an immutable cross-contract call
                         target. The grace_period_seconds parameter sets the
                         default grace period for failed payments.

  **PARAMETERS**         

  admin                  Address --- The admin address. Should match the
                         SubscriptionRegistry admin for consistent access control.

  registry_id            Address --- The deployed address of the
                         SubscriptionRegistry contract. Immutable after init.

  usdc_sac               Address --- The USDC SAC address. Must match the value
                         used in SubscriptionRegistry.

  grace_period_seconds   u64 --- Default grace period in seconds. Minimum 3600 (1
                         hour). Recommended: 259200 (3 days).

  **Returns**            ()

  **ERROR CODES**        

  AlreadyInitialized     Contract has already been initialised.

  InvalidGracePeriod     grace_period_seconds is less than 3600.

  **Notes**              After initialising, grant BillingCycle admin-equivalent
                         authority on SubscriptionRegistry via the registry\'s
                         grant_operator function so BillingCycle can call
                         update_subscription_status and renew_subscription.
  ---------------------- ----------------------------------------------------------

  ----------------------- ----------------------------------------------------------
  **Function**            **initiate_subscription(env, customer, plan_id)**

  **Visibility**          Public --- customer must invoke (auth required).

  **Description**         Entry point for a new subscription. The customer calls
                          this function, which immediately attempts to charge the
                          first billing amount via USDC SAC transfer. If the plan
                          has a trial period, the initial charge is 0 USDC. On
                          success, calls SubscriptionRegistry.create_subscription to
                          write the record. On SAC transfer failure, returns an
                          error without writing any state.

  **PARAMETERS**          

  customer                Address --- The customer\'s wallet address. Must be the
                          invoker --- prevents subscriptions being created on behalf
                          of others without their consent.

  plan_id                 u64 --- The plan the customer wants to subscribe to.

  **Returns**             SubscriptionRecord --- the newly created subscription

  **ERROR CODES**         

  PlanNotFound            No active plan with this ID exists in the registry.

  InsufficientAllowance   Customer has not granted sufficient USDC SAC allowance to
                          the BillingCycle contract address.

  InsufficientBalance     Customer wallet has insufficient USDC balance.

  AlreadySubscribed       Customer already has a non-cancelled subscription.

  **Notes**               Customers must call
                          USDC_SAC.approve(billing_cycle_address, amount, expiry)
                          before calling this function. The recommended allowance is
                          plan.price_usdc multiplied by 13 (one year of monthly
                          payments), with expiry set to 1 year from now. The
                          frontend SDK handles this approval flow automatically.
  ----------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **process_renewals(env, customers)**

  **Visibility**    Admin only. Called by the Invoq backend cron job.

  **Description**   Processes renewal payments for a batch of customers whose
                    billing periods have expired. For each customer in the
                    list, checks if current_period_end \<= now and the
                    subscription is Active or GracePeriod, then attempts the
                    USDC SAC transfer. On success, calls
                    SubscriptionRegistry.renew_subscription. On failure,
                    transitions to GracePeriod or Cancelled depending on grace
                    period status. Returns a summary of processed renewals.

  **PARAMETERS**    

  customers         Vec\<Address\> --- List of customer wallet addresses to
                    process renewals for. Maximum 30 per call to stay within
                    Soroban instruction limits.

  **Returns**       RenewalSummary --- struct containing counts of successful,
                    failed, and grace_period renewals

  **ERROR CODES**   

  Unauthorized      Invoker is not the contract admin.

  BatchTooLarge     customers Vec contains more than 30 addresses.

  **Notes**         The Invoq backend queries SubscriptionRegistry off-chain
                    to build the customer list of due renewals, then passes it
                    to this function. Processing is atomic per-customer --- a
                    failure for one customer does not roll back successful
                    renewals for others in the batch.
  ----------------- ----------------------------------------------------------

  ---------------------- ----------------------------------------------------------
  **Function**           **retry_failed_payment(env, customer)**

  **Visibility**         Admin only.

  **Description**        Manually retries a USDC payment for a customer currently
                         in GracePeriod. Attempts the SAC transfer immediately. On
                         success, transitions the subscription back to Active and
                         advances the billing period from the original renewal date
                         (not from the retry date) to preserve billing cycle
                         alignment. On failure, leaves the subscription in
                         GracePeriod.

  **PARAMETERS**         

  customer               Address --- The customer wallet in GracePeriod to retry
                         payment for.

  **Returns**            bool --- true if payment succeeded, false if still failed

  **ERROR CODES**        

  SubscriptionNotFound   No subscription record for this customer.

  NotInGracePeriod       Subscription is not in GracePeriod status.

  Unauthorized           Invoker is not the contract admin.

  **Notes**              The period advance on successful retry uses the original
                         current_period_end as the new period start, not the
                         current timestamp. This preserves predictable renewal
                         dates.
  ---------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **expire_grace_periods(env, customers)**

  **Visibility**    Admin only. Called by the Invoq backend cron job.

  **Description**   Checks each customer in the list whose subscription is in
                    GracePeriod, and if the grace period has now elapsed,
                    transitions the subscription to Cancelled via
                    SubscriptionRegistry.update_subscription_status. Fires a
                    subscription_cancelled event for each expired grace
                    period. This function is called by a separate,
                    lower-frequency cron job than process_renewals.

  **PARAMETERS**    

  customers         Vec\<Address\> --- List of customer addresses in
                    GracePeriod to check. Maximum 50 per call.

  **Returns**       u32 --- count of subscriptions expired in this call

  **ERROR CODES**   

  Unauthorized      Invoker is not the contract admin.

  **Notes**         A grace period is considered elapsed when
                    env.ledger().timestamp() \>=
                    subscription.current_period_end + grace_period_seconds.
  ----------------- ----------------------------------------------------------

  -------------------- ----------------------------------------------------------
  **Function**         **update_grace_period(env, new_grace_seconds)**

  **Visibility**       Admin only.

  **Description**      Updates the global grace period duration for future
                       payment failures. Does not affect subscriptions already in
                       GracePeriod --- their expiry was computed at the time they
                       entered GracePeriod. New value applies to all payment
                       failures after this call.

  **PARAMETERS**       

  new_grace_seconds    u64 --- New grace period in seconds. Minimum 3600 (1
                       hour).

  **Returns**          ()

  **ERROR CODES**      

  InvalidGracePeriod   new_grace_seconds is less than 3600.

  Unauthorized         Invoker is not the contract admin.

  **Notes**            Emits a grace_period_updated event. Recommended to keep
                       grace period at 3 days minimum to give customers time to
                       top up their USDC balance.
  -------------------- ----------------------------------------------------------

**Contract 3 --- SpendPolicy**

*SpendPolicy enforces budget guardrails for AI agents and enterprise
customers --- daily spending caps, per-transaction limits, and wallet
allowlists --- without removing autonomous payment capability.*

**Purpose and responsibilities**

SpendPolicy is the only Invoq contract that integrates with
OpenZeppelin\'s smart account contracts on Stellar. It provides a policy
enforcement layer that enterprise customers can configure to control how
their deployed AI agents spend USDC. An agent that has a SpendPolicy
enforced against it cannot exceed its configured daily budget, cannot
transact above its per-transaction limit, and can only send payments to
pre-approved destination addresses.

SpendPolicy is optional --- it only applies to customers who have
explicitly created a policy. Standard subscription customers do not
interact with SpendPolicy at all. It is most relevant for enterprise
accounts deploying multiple autonomous agents that need auditable budget
controls.

**Storage layout**

  ---------------------- ------------ ---------------------------------------
  **Key**                **Storage    **Description**
                         type**       

  ADMIN                  Instance     Contract admin address.

  POLICY:{owner}         Persistent   SpendPolicyConfig struct keyed by the
                                      policy owner\'s address.

  DAILY_SPENT:{owner}    Persistent   Running total of USDC spent today by
                                      this owner, in stroops. Keyed with
                                      today\'s date for daily reset.

  AGENT_POLICY:{agent}   Persistent   Maps an agent address to its owner\'s
                                      policy. Allows policy lookup by agent
                                      address.
  ---------------------- ------------ ---------------------------------------

**Data structures**

**SPENDPOLICYCONFIG STRUCT**

  ------------------ ---------------- ----------------------------------------
  **Field**          **Type**         **Description**

  owner              Address          The enterprise customer who created and
                                      controls this policy.

  daily_limit_usdc   i128             Maximum USDC stroops that can be spent
                                      per calendar day. 0 = unlimited.

  tx_limit_usdc      i128             Maximum USDC stroops per individual
                                      transaction. 0 = unlimited.

  allowlist          Vec\<Address\>   Permitted destination addresses. If
                                      non-empty, payments to any address not
                                      in this list are rejected.

  agents             Vec\<Address\>   Agent wallet addresses this policy
                                      governs. Max 100 agents per policy.

  active             bool             Whether this policy is currently
                                      enforced. When false, all checks pass
                                      immediately.
  ------------------ ---------------- ----------------------------------------

**Functions**

  -------------------- ----------------------------------------------------------
  **Function**         **initialize(env, admin)**

  **Visibility**       Public --- callable once only.

  **Description**      Initialises the SpendPolicy contract with the admin
                       address. No other dependencies --- SpendPolicy is
                       standalone and does not require Registry or BillingCycle
                       addresses.

  **PARAMETERS**       

  admin                Address --- The contract admin address.

  **Returns**          ()

  **ERROR CODES**      

  AlreadyInitialized   Contract already initialised.

  **Notes**            SpendPolicy can be deployed independently at any time. It
                       does not need to be deployed before other contracts.
  -------------------- ----------------------------------------------------------

  --------------------- ----------------------------------------------------------
  **Function**          **create_policy(env, owner, daily_limit_usdc, tx_limit_usdc,
                        allowlist, agents)**

  **Visibility**        Public --- owner must sign.

  **Description**       Creates a new spend policy for owner. The owner address
                        authorizes the call. Registers all addresses in the
                        agents list as governed by this policy for efficient
                        lookup in check_spend.

  **PARAMETERS**

  owner                 Address --- Policy owner address. Must authorize the
                        transaction.

  daily_limit_usdc      i128 --- Daily spending limit in USDC stroops. Pass 0 for
                        no limit.

  tx_limit_usdc         i128 --- Per-transaction limit in USDC stroops. Pass 0 for
                        no limit.

  allowlist             Vec\<Address\> --- Permitted payment destinations. Pass
                        empty Vec to allow any destination.

  agents                Vec\<Address\> --- Agent wallet addresses to govern with
                        this policy. Max 100 entries.

  **Returns**           ()

  **ERROR CODES**       

  PolicyAlreadyExists   A policy already exists for this owner. Call update_policy
                        to modify it.

  TooManyAgents         agents Vec contains more than 100 addresses.

  **Notes**             Emits a policy_created event. Each agent address is
                        indexed individually in AGENT_POLICY storage for O(1)
                        lookup during spend checks.
  --------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **check_spend(env, agent, destination, amount_usdc)**

  **Visibility**    Public --- read-only. No auth required.

  **Description**   The primary enforcement function. Checks whether a
                    proposed payment from an agent to a destination for the
                    given USDC amount is permitted under the governing policy.
                    Returns a detailed SpendCheckResult. Never panics
                    --- if no policy is found for the agent, the check passes
                    (permissive default).

  **PARAMETERS**    

  agent             Address --- The agent wallet attempting to make the
                    payment.

  destination       Address --- The address the payment would be sent to.

  amount_usdc       i128 --- The payment amount in USDC stroops.

  **Returns**       SpendCheckResult --- Allowed, NoPolicyFound,
                    BlockedByAllowlist, BlockedByTxLimit, or
                    BlockedByDailyLimit

  **Notes**         Called by the Invoq API layer before any agent-initiated
                    payment is executed. Three checks are performed in order:
                    (1) allowlist check --- destination must be in allowlist
                    if non-empty; (2) tx_limit check --- amount must not
                    exceed tx_limit_usdc; (3) daily_limit check --- amount
                    plus today\'s running total must not exceed
                    daily_limit_usdc.
  ----------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **record_spend(env, agent, amount_usdc)**

  **Visibility**    Admin only. Called by the Invoq backend after a confirmed
                    payment.

  **Description**   Records a confirmed USDC spend against the agent\'s
                    governing policy\'s daily counter. Increments DAILY_SPENT
                    for today\'s date key. This function is called only after
                    a payment has been confirmed on-chain --- it is the audit
                    trail, not the enforcement gate.

  **PARAMETERS**    

  agent             Address --- The agent wallet that made the payment.

  amount_usdc       i128 --- The confirmed payment amount in USDC stroops.

  **Returns**       i128 --- the new daily total for this policy owner

  **ERROR CODES**   

  NoPolicyFound     No policy found for this agent.

  Unauthorized      Invoker is not the contract admin.

  **Notes**         Daily counters are keyed by owner_address + date_string
                    (YYYY-MM-DD in UTC). The Invoq backend handles daily reset
                    by using a new key each day --- old keys expire via TTL
                    after 30 days.
  ----------------- ----------------------------------------------------------

  ------------------ ----------------------------------------------------------
  **Function**       **update_policy(env, caller, daily_limit_usdc, tx_limit_usdc,
                     allowlist, agents)**

  **Visibility**     Policy owner only.

  **Description**    Updates all fields of caller\'s existing spend
                     policy. All changes take effect immediately --- the next
                     check_spend call after an update reflects the new values.
                     Agent list changes are reflected in AGENT_POLICY storage
                     atomically.

  **PARAMETERS**

  caller             Address --- Policy owner address. Must authorize the
                     transaction.

  daily_limit_usdc   i128 --- New daily spending limit. Pass 0 for unlimited.

  tx_limit_usdc      i128 --- New per-transaction limit. Pass 0 for unlimited.

  allowlist          Vec\<Address\> --- New destination allowlist. Replaces
                     existing list entirely.

  agents             Vec\<Address\> --- New agent list. Agents removed from the
                     list are deregistered from AGENT_POLICY storage.

  **Returns**        ()

  **ERROR CODES**    

  NoPolicyFound      No policy exists for this owner.

  TooManyAgents      agents Vec contains more than 100 entries.

  **Notes**          Emits a policy_updated event. Removing agents from the
                     policy does not prevent them from transacting --- it
                     simply means their transactions no longer accrue to this
                     policy\'s daily counter.
  ------------------ ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **deactivate_policy(env, caller)**

  **Visibility**    Policy owner or admin only.

  **Description**   Temporarily deactivates caller\'s spend policy. While
                    inactive, all check_spend calls for agents governed by
                    this policy return true immediately without any limit
                    checking. Used when an enterprise customer needs to
                    perform emergency transactions outside normal budget
                    rules.

  **Returns**       ()

  **ERROR CODES**   

  NoPolicyFound     No policy exists for this owner.

  AlreadyInactive   Policy is already inactive.

  **Notes**         Emits a policy_deactivated event. Should be paired with a
                    reactivate_policy call as soon as the emergency is
                    resolved. Admin activity log records the timestamp and
                    caller of all deactivations.
  ----------------- ----------------------------------------------------------

**Contract 4 --- EscrowVault**

*EscrowVault is the only Invoq contract that holds customer funds. It
enables usage-based billing by letting customers deposit USDC upfront
and having the metering system draw down balances in real time.*

**Purpose and responsibilities**

EscrowVault is designed for the API developer or data provider use case:
a customer deposits USDC into a vault, and as they consume API
resources, the Invoq metering system calls debit_vault to decrement
their balance. When the balance drops below a configurable threshold,
the contract emits a low_balance event that triggers an automated
notification. The customer can top up at any time. Any unspent balance
can be withdrawn in full by the customer.

EscrowVault is completely non-custodial in the trust model sense --- the
contract enforces that only the depositor can withdraw their balance,
and the Invoq platform (via admin) can only debit for actual API usage.
The contract cannot transfer funds to the platform operator\'s wallet
directly.

> ⚠ EscrowVault is the only contract that holds user funds. Extra care
> must be taken during the security audit of this contract. Withdrawal
> logic must be audited for re-entrancy patterns even though Soroban\'s
> execution model makes classic re-entrancy impossible. Focus on logic
> errors in balance accounting.

**Storage layout**

  ------------------- ------------ ---------------------------------------
  **Key**             **Storage    **Description**
                      type**       

  ADMIN               Instance     Contract admin address.

  USDC_SAC            Instance     USDC SAC address. Immutable after init.

  VAULT:{customer}    Persistent   VaultRecord struct for each customer
                                   vault.

  OWNER:{developer}   Persistent   Maps developer wallet to their set of
                                   active vault customer addresses for
                                   revenue tracking.
  ------------------- ------------ ---------------------------------------

**Data structures**

**VAULTRECORD STRUCT**

  ----------------------- ---------------- ----------------------------------------
  **Field**               **Type**         **Description**

  customer                Address          The customer wallet that owns this
                                           vault.

  developer               Address          The developer wallet whose API usage is
                                           being paid from this vault.

  balance_usdc            i128             Current vault balance in USDC stroops.

  total_deposited         i128             Cumulative total deposited since vault
                                           creation. For analytics.

  total_debited           i128             Cumulative total debited since vault
                                           creation. For analytics and dispute
                                           resolution.

  low_balance_threshold   i128             Balance below which a low_balance event
                                           is fired. Set by the customer. Default:
                                           10 USDC.

  auto_topup_amount       Option\<i128\>   If Some, auto top-up this amount when
                                           balance drops below threshold. Requires
                                           pre-authorised SAC allowance.

  created_at              u64              Unix timestamp of vault creation.
  ----------------------- ---------------- ----------------------------------------

**Functions**

  -------------------- ----------------------------------------------------------
  **Function**         **initialize(env, admin, usdc_sac)**

  **Visibility**       Public --- callable once only.

  **Description**      Initialises the EscrowVault contract with the admin
                       address and USDC SAC address.

  **PARAMETERS**       

  admin                Address --- Contract admin address.

  usdc_sac             Address --- USDC SAC address. Immutable after init.

  **Returns**          ()

  **ERROR CODES**      

  AlreadyInitialized   Contract already initialised.

  **Notes**            EscrowVault can be deployed independently. It does not
                       require Registry or BillingCycle addresses.
  -------------------- ----------------------------------------------------------

  ----------------------- ----------------------------------------------------------
  **Function**            **create_vault(env, developer, initial_deposit,
                          low_balance_threshold, auto_topup_amount)**

  **Visibility**          Public --- invoker becomes the vault owner (customer).

  **Description**         Creates a new vault for the invoker and immediately
                          deposits the initial_deposit amount from their wallet via
                          USDC SAC transfer. The developer parameter specifies which
                          developer\'s API product this vault is funding --- debit
                          calls must originate from the admin acting on that
                          developer\'s behalf. Sets the low_balance_threshold and
                          optional auto top-up configuration.

  **PARAMETERS**          

  developer               Address --- The developer wallet whose API usage this
                          vault is paying for.

  initial_deposit         i128 --- Initial USDC deposit in stroops. Minimum
                          1,000,000 stroops (0.10 USDC).

  low_balance_threshold   i128 --- Balance threshold in stroops below which a
                          low_balance event fires. Minimum 0.

  auto_topup_amount       Option\<i128\> --- If Some, automatically top up this
                          amount when balance drops below threshold. Requires SAC
                          allowance. Pass None to disable auto top-up.

  **Returns**             VaultRecord --- the newly created vault

  **ERROR CODES**         

  VaultAlreadyExists      A vault already exists for this customer and developer
                          combination.

  InsufficientBalance     Customer wallet has insufficient USDC for the initial
                          deposit.

  DepositTooSmall         initial_deposit is less than 1,000,000 stroops.

  **Notes**               Emits a vault_created event and a vault_deposited event
                          for the initial deposit. The SAC transfer of
                          initial_deposit occurs atomically within this call --- if
                          it fails, no vault is created.
  ----------------------- ----------------------------------------------------------

  --------------------- ----------------------------------------------------------
  **Function**          **deposit(env, customer, developer, amount)**

  **Visibility**        Public --- customer must invoke.

  **Description**       Adds USDC to an existing vault. The invoker must be the
                        vault owner. Transfers amount from the customer\'s wallet
                        to the EscrowVault contract account via USDC SAC. Updates
                        balance_usdc and total_deposited in the VaultRecord. If
                        the vault had previously fired a low_balance event and the
                        new balance is above the threshold, emits a
                        balance_restored event.

  **PARAMETERS**        

  customer              Address --- The vault owner making the deposit. Must be
                        the invoker.

  developer             Address --- The developer wallet identifying which vault
                        to deposit into.

  amount                i128 --- Deposit amount in USDC stroops. Minimum 1,000,000
                        stroops.

  **Returns**           i128 --- the new vault balance after deposit

  **ERROR CODES**       

  VaultNotFound         No vault exists for this customer and developer
                        combination.

  InsufficientBalance   Customer wallet has insufficient USDC.

  DepositTooSmall       amount is less than 1,000,000 stroops.

  Unauthorized          Invoker is not the vault owner.

  **Notes**             Emits a vault_deposited event with the new balance. Auto
                        top-up calls this function internally when a debit
                        triggers a low balance.
  --------------------- ----------------------------------------------------------

  -------------------------- ----------------------------------------------------------
  **Function**               **debit_vault(env, customer, developer, amount,
                             usage_description)**

  **Visibility**             Admin only. Called by the Invoq metering service.

  **Description**            Debits an amount from a customer\'s vault and transfers it
                             directly to the developer\'s wallet via USDC SAC. This is
                             the core revenue distribution function --- API usage fees
                             flow from the customer\'s vault to the developer in real
                             time. If the debit would reduce the balance below zero, it
                             is rejected. If the debit reduces the balance below
                             low_balance_threshold, a low_balance event is fired and
                             auto top-up is triggered if configured.

  **PARAMETERS**             

  customer                   Address --- The vault owner being debited.

  developer                  Address --- The developer receiving the payment.

  amount                     i128 --- Amount to debit in USDC stroops.

  usage_description          String --- Human-readable description of what usage this
                             debit covers, e.g. \"1000 API tokens\". Stored in event
                             for audit trail. Max 128 chars.

  **Returns**                i128 --- the remaining vault balance after debit

  **ERROR CODES**            

  VaultNotFound              No vault exists for this customer and developer.

  InsufficientVaultBalance   Vault balance is insufficient for this debit. Debit is
                             rejected.

  Unauthorized               Invoker is not the contract admin.

  **Notes**                  Emits a vault_debited event with amount, new_balance, and
                             usage_description. The developer receives funds
                             immediately --- there is no escrow release step. If auto
                             top-up is configured and the new balance is below
                             threshold, an async top-up is triggered in the same
                             transaction.
  -------------------------- ----------------------------------------------------------

  -------------------------- ----------------------------------------------------------
  **Function**               **withdraw(env, customer, developer, amount)**

  **Visibility**             Customer (vault owner) only.

  **Description**            Withdraws USDC from a vault back to the customer\'s
                             wallet. The customer can withdraw any amount up to the
                             current balance at any time, for any reason. There is no
                             lock-up period. Funds are returned via USDC SAC transfer
                             from the EscrowVault contract account to the customer\'s
                             wallet.

  **PARAMETERS**             

  customer                   Address --- The vault owner making the withdrawal. Must be
                             the invoker.

  developer                  Address --- Identifies which vault to withdraw from.

  amount                     i128 --- Withdrawal amount in USDC stroops. Must be \<=
                             current balance.

  **Returns**                i128 --- the remaining vault balance after withdrawal

  **ERROR CODES**            

  VaultNotFound              No vault exists for this customer and developer.

  InsufficientVaultBalance   Requested withdrawal amount exceeds current balance.

  Unauthorized               Invoker is not the vault owner.

  **Notes**                  Emits a vault_withdrawn event. Customers should be
                             informed in the dashboard UI that withdrawal removes API
                             access for the debited developer once the balance reaches
                             zero --- but the contract does not enforce this, it only
                             manages the funds.
  -------------------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **close_vault(env, customer, developer)**

  **Visibility**    Customer (vault owner) or admin only.

  **Description**   Permanently closes a vault and returns the entire
                    remaining balance to the customer\'s wallet. Removes the
                    VaultRecord from storage. After a vault is closed,
                    create_vault can be called again to open a new vault for
                    the same customer-developer pair. Admin can close vaults
                    on behalf of customers (e.g. for account termination).

  **PARAMETERS**    

  customer          Address --- The vault owner.

  developer         Address --- Identifies which vault to close.

  **Returns**       i128 --- the amount refunded to the customer

  **ERROR CODES**   

  VaultNotFound     No vault exists for this customer and developer.

  Unauthorized      Invoker is neither the vault owner nor the contract admin.

  **Notes**         Emits a vault_closed event with the refunded amount. If
                    the balance is 0, the vault is closed without a transfer.
  ----------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **get_vault(env, customer, developer)**

  **Visibility**    Public --- read-only. No auth required.

  **Description**   Returns the full VaultRecord for a customer-developer
                    pair. Used by the Invoq dashboard to display current
                    balance, usage totals, and top-up history.

  **PARAMETERS**    

  customer          Address --- The vault owner address.

  developer         Address --- The developer address identifying the vault.

  **Returns**       Option\<VaultRecord\> --- None if no vault exists

  **Notes**         Returns None rather than panicking for non-existent
                    vaults.
  ----------------- ----------------------------------------------------------

  ----------------- ----------------------------------------------------------
  **Function**      **update_threshold(env, customer, developer,
                    new_threshold, new_auto_topup)**

  **Visibility**    Customer (vault owner) only.

  **Description**   Updates the low balance alert threshold and auto top-up
                    configuration for a vault. Takes effect immediately ---
                    the next debit that drops balance below the new threshold
                    will fire the event.

  **PARAMETERS**    

  customer          Address --- The vault owner. Must be the invoker.

  developer         Address --- Identifies which vault to update.

  new_threshold     i128 --- New low balance threshold in USDC stroops.
                    Minimum 0.

  new_auto_topup    Option\<i128\> --- New auto top-up amount. None to
                    disable. If Some, customer must have SAC allowance \>=
                    this amount.

  **Returns**       ()

  **ERROR CODES**   

  VaultNotFound     No vault for this customer and developer.

  Unauthorized      Invoker is not the vault owner.

  **Notes**         Emits a vault_updated event.
  ----------------- ----------------------------------------------------------

**Where to Start --- Development Order**

*Follow this exact sequence. Each step depends on the previous one being
complete and tested.*

  -------- ---------------------- ------------------------------- -------------
  **\#**   **Task**               **What to do**                  **Time
                                                                  estimate**

  1        Dev environment        Install Rust, Soroban CLI,      Half day
                                  Stellar SDK. Run soroban        
                                  contract init. Get the local    
                                  sandbox running. Deploy         
                                  hello_world to confirm setup.   

  2        USDC SAC on Testnet    Get the Stellar Testnet USDC    2 hours
                                  SAC address from the Stellar    
                                  documentation. Fund test        
                                  wallets with XLM and Testnet    
                                  USDC using Friendbot.           

  3        SubscriptionRegistry   Build and test all functions in 5--6 days
                                  this document. Write unit tests 
                                  for every error case. Deploy to 
                                  Testnet. Verify storage layout  
                                  is correct.                     

  4        BillingCycle           Build BillingCycle with the     5--6 days
                                  deployed Registry address. Test 
                                  initiate_subscription           
                                  end-to-end with a real SAC      
                                  transfer on Testnet. Test the   
                                  full renewal flow.              

  5        EscrowVault            Build and test EscrowVault. The 4--5 days
                                  deposit → debit → withdraw      
                                  cycle must be tested with real  
                                  USDC SAC transfers. Test        
                                  low_balance event and auto      
                                  top-up.                         

  6        SpendPolicy            Build SpendPolicy last. It is   3--4 days
                                  standalone. Test check_spend    
                                  with various policy             
                                  configurations. Test the daily  
                                  counter reset logic carefully.  

  7        Integration tests      Write a full end-to-end test:   2--3 days
                                  create plan → subscribe → check 
                                  entitlement → record usage →    
                                  process renewal → cancel. Run   
                                  against Testnet.                

  8        API layer (Node.js)    Build the Fastify REST API on   2--3 weeks
                                  top of the contracts. The API   
                                  is the only caller of           
                                  admin-only functions ---        
                                  implement proper key management 
                                  here.                           

  9        Security audit         Submit all four Soroban         2--3 weeks
                                  contracts for professional      
                                  audit before mainnet            
                                  deployment. Focus audit on      
                                  EscrowVault fund safety and     
                                  BillingCycle payment logic.     

  10       Mainnet deploy         Deploy all four contracts to    1 day
                                  Stellar Mainnet. Verify with a  
                                  small real USDC transaction     
                                  before opening to developers.   
  -------- ---------------------- ------------------------------- -------------

> ℹ The most common mistake when building Soroban billing contracts is
> calling env.ledger().timestamp() inconsistently. Always use it in the
> same place --- at the start of a function call --- and pass it through
> to sub-functions rather than calling it multiple times. Two calls in
> the same transaction can theoretically return different values.

**Key Soroban resources**

-   **Soroban Documentation:**
    developers.stellar.org/docs/build/smart-contracts

-   **Stellar Asset Contract (SAC) guide:**
    developers.stellar.org/docs/tokens/stellar-asset-contract

-   **Soroban CLI reference:** stellar.org/developers/tools/sdks/library

-   **OpenZeppelin Stellar smart accounts:**
    github.com/OpenZeppelin/openzeppelin-stellar-contracts

-   **Testnet Friendbot (fund test wallets):** friendbot.stellar.org

-   **Testnet Horizon explorer:** horizon-testnet.stellar.org

Invoq · Smart Contract Specification · Version 1.0 · May 2026

Production-ready Soroban contracts · Built for Stellar Mainnet
