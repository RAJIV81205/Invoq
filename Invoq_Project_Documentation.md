**Invoq**

*Programmable Subscription Billing for the Agentic Internet*

Project Documentation · SCF Grant Proposal

Version 1.0 · May 2026

Built on top of x402 · Soroban · Stellar USDC

Applying for SCF Build Award · Open Track

**1. Executive Summary**

*Invoq fills the only missing layer in Stellar\'s agentic payment stack:
managed recurring billing for developers and businesses.*

The Stellar network now has two production-ready agentic payment
protocols --- x402 for per-request micropayments and MPP for streaming
sessions. Both solve how AI agents pay for individual API calls. Neither
solves how a developer builds a subscription business, manages billing
plans, tracks monthly recurring revenue, or handles customer lifecycle
management on Stellar.

Invoq is that layer. It is a hosted subscription billing platform ---
think Stripe Billing, but built natively on Soroban smart contracts and
settling in USDC on Stellar. It exposes a simple REST API and developer
SDKs so that any AI developer, SaaS builder, or API provider can offer
subscription plans and usage-based billing to their customers without
writing a single line of blockchain code.

> *Invoq does not compete with x402. It builds directly on top of x402
> and Soroban, making them commercially viable for an entirely new
> category of Stellar developer.*

The project targets the SCF Open Track with a focused 16-week build
scope, a \$60,000--\$80,000 grant ask, and four milestone-gated
deliverable tranches. Every component it builds --- Soroban contracts,
REST API, JavaScript and Python SDKs, and developer dashboard ---
increases Stellar USDC volume, Soroban invocations, and developer
adoption in ways that are directly measurable and aligned with SDF\'s
2026 ecosystem goals.

**2. The Problem**

**2.1 The gap x402 deliberately left open**

x402 was designed with a specific philosophy: kill the API key, kill the
subscription, and enable true pay-per-request commerce. This philosophy
is correct for a large category of AI agent use cases --- a trading bot
paying \$0.01 per data query, an autonomous research agent paying
per-page for web content, or an MCP tool monetizing per invocation.

But it is the wrong model for an equally large category of real-world
developer products:

-   An AI writing tool that charges users \$20/month for 100,000 tokens

-   A developer API that offers a Free tier (1,000 requests/day), Pro
    tier (100,000 requests/day), and Enterprise tier (unlimited)

-   A SaaS product that gives users a 14-day free trial before billing
    begins

-   An automation platform that charges \$0.005 per task completed,
    capped at \$49/month

-   A data provider that invoices enterprise customers monthly with
    payment net-30

These products need subscription state. They need a system that
remembers who is on which plan, when their billing cycle renews, how
much of their usage quota they have consumed, and what to do when a
payment fails. x402 has none of this by design --- it is stateless,
per-request, and intentionally has no accounts.

**2.2 What developers are forced to do today**

A Stellar developer who wants to build a subscription business today
faces three bad options:

  ----------------- ------------------------- ----------------------------
  **Option**        **What it looks like**    **Why it fails**

  **Use Stripe**    Accept fiat, manually     Defeats the purpose of
                    off-ramp to USDC          building on Stellar. No
                                              stablecoin settlement, no
                                              agent-native access.

  **Build it        Write custom Soroban      4--6 months of
  themselves**      contracts, billing state  infrastructure work before
                    machines, renewal logic   shipping a single
                                              user-facing feature. Most
                                              developers skip Stellar
                                              entirely.

  **Skip            Only offer                Limits the product to a
  subscriptions**   pay-per-request via x402  small segment of users.
                                              Unpredictable revenue.
                                              Cannot serve enterprise
                                              customers.
  ----------------- ------------------------- ----------------------------

The result is that Stellar has a thriving per-request payment ecosystem
but almost no subscription-based developer products. Invoq fixes this.

**2.3 Why this matters for the Stellar ecosystem**

Subscription billing is the economic engine of the modern developer and
SaaS economy. Monthly recurring revenue is how developer tools get
funded, how AI APIs grow sustainably, and how small builders achieve
financial independence. Without a native subscription layer, Stellar
cannot participate in this economy.

Every SaaS developer or AI API builder who wants to monetize on-chain
today is choosing Stripe over Stellar --- not because Stellar\'s payment
infrastructure is worse, but because Stripe has the billing management
layer and Stellar does not. Invoq closes that gap.

**3. The Solution**

*Invoq is a subscription billing platform built natively on Soroban
smart contracts, settling in Stellar USDC, and composable with x402.*

**3.1 What Invoq is**

Invoq is three things simultaneously:

-   **A set of Soroban smart contracts that encode subscription state,
    billing cycles, and payment enforcement on-chain**

-   **A hosted REST API and SDK layer that exposes subscription
    management as simple function calls --- no blockchain knowledge
    required**

-   **A developer dashboard that gives subscription businesses
    visibility into revenue, customers, usage, and payouts**

A developer integrates Invoq the same way they would integrate Stripe:
add a few lines of SDK code to their backend, define their pricing plans
in the dashboard, and Invoq handles everything else --- plan
enforcement, renewal billing, payment failure handling, customer
management, and USDC settlement on Stellar.

**3.2 What Invoq is not**

Invoq is not a replacement for x402. It is not a new payment protocol.
It is not a wallet provider. It does not compete with any infrastructure
that SDF has already built or is building. It is the application layer
that sits above the payment primitives and makes them commercially
useful for subscription businesses.

**3.3 The key insight: complementary infrastructure**

x402 and Invoq serve different billing models, and most real products
need both:

  ---------------- --------------------------- ---------------------------
                   **x402 (existing)**         **Invoq (new layer)**

  **Billing        Per-request, stateless      Subscription plans, usage
  model**                                      tiers, trials

  **State**        None --- ephemeral          On-chain via Soroban
                                               contracts

  **Customer       Wallet addresses only       Full customer and
  records**                                    subscription lifecycle

  **Revenue        Pay-as-you-go               MRR, ARR, usage caps,
  model**                                      invoicing

  **Settlement**   Stellar USDC                Stellar USDC (via x402 or
                                               direct SAC)

  **Target users** AI agents, bots, automated  SaaS developers, API
                   systems                     providers, AI tools
  ---------------- --------------------------- ---------------------------

A developer building an AI API platform might use Invoq to manage their
Pro and Enterprise plans, and embed x402 directly for the
pay-per-request Free tier. The two tools compose naturally --- Invoq can
verify plan entitlements before an x402 payment is attempted, and x402
settlement events can be fed into Invoq\'s usage metering system.

**4. How Invoq Works**

**4.1 The system architecture**

Invoq is structured as four layers, each building on the one below it:

  ----------- ---------------------- -------------------------------------
  **Layer**   **Component**          **What it does**

  **Layer 4** Developer Dashboard    Next.js web application. Revenue
                                     analytics, customer management, plan
                                     configuration, invoice history,
                                     payout controls. Human-readable
                                     interface for the entire platform.

  **Layer 3** API + SDK Surface      Node.js / Fastify REST API.
                                     JavaScript and Python SDKs. Abstracts
                                     all blockchain complexity. Developers
                                     interact with simple function calls
                                     like createPlan(), subscribe(),
                                     checkEntitlement(), recordUsage().

  **Layer 2** Subscription Engine    Billing cycle management, plan
                                     enforcement, usage metering, webhook
                                     event delivery. MongoDB + Redis
                                     for fast state reads. The operational
                                     brain of the platform.

  **Layer 1** Soroban Contracts      Four Rust smart contracts deployed on
                                     Stellar. Encode subscription state,
                                     billing cycles, spend policies, and
                                     escrow vaults on-chain. The source of
                                     truth that cannot be tampered with.

  **Layer 0** x402 + Stellar USDC    The settlement layer. x402 handles
                                     per-request payments. Soroban SAC
                                     transfers handle subscription
                                     renewals. 5-second finality. 99.99%
                                     network uptime.
  ----------- ---------------------- -------------------------------------

**4.2 The Soroban smart contracts**

The four on-chain contracts are the foundation of Invoq\'s trust model.
They cannot be altered after deployment, ensuring that subscription
terms are enforceable and transparent.

**SubscriptionRegistry**

The SubscriptionRegistry contract is the on-chain source of truth for
all active subscriptions. It stores a mapping from customer wallet
addresses to their current plan, subscription status, and feature
entitlements. When a developer\'s backend calls checkEntitlement(), this
contract is queried to determine whether a given wallet has access to a
given feature tier. Plan definitions --- price, interval, trial period,
feature flags --- are also stored here and can only be updated by the
plan creator.

**BillingCycle**

The BillingCycle contract tracks the next renewal timestamp for every
active subscription and executes automated USDC debits via the Stellar
Asset Contract on cycle close. It implements a configurable grace period
--- if a payment fails, the contract enters a grace state for a defined
duration before downgrading or cancelling the subscription. All state
transitions are recorded on-chain and are visible to both the developer
and the subscriber.

**SpendPolicy**

The SpendPolicy contract integrates with OpenZeppelin\'s smart account
contracts already deployed on Stellar to enforce per-agent and
per-customer budget controls. A SaaS developer can configure daily
spending caps, per-request allowlists, and approval thresholds for their
customers\' AI agents. This allows enterprise customers to deploy agents
that operate autonomously within defined financial guardrails without
human intervention for every transaction.

**EscrowVault**

The EscrowVault contract enables prepaid credit models --- the
usage-based billing pattern preferred by AI API developers. Customers
deposit a USDC balance upfront. As API calls are made, the Invoq
metering system draws down the balance. When the balance falls below a
configurable threshold, an automated top-up request is triggered. Any
unspent balance can be withdrawn by the customer at any time. This model
works particularly well for AI tool providers who want to charge per
token or per task without per-request blockchain overhead.

**4.3 The billing flow, end to end**

Here is the full lifecycle of a Invoq subscription from creation to
renewal:

1.  Developer creates a plan in the Invoq dashboard or via API, defining
    the price, interval (monthly or annual), trial period, usage limits,
    and feature flags.

2.  Plan definition is written to the SubscriptionRegistry contract on
    Stellar mainnet. The plan now has a deterministic on-chain address
    that anyone can verify.

3.  A customer visits the developer\'s product and initiates a
    subscription. Their Stellar wallet signs the initial payment
    authorization. The BillingCycle contract records their start
    timestamp and next renewal date.

4.  The developer\'s backend calls checkEntitlement() on any incoming
    API request. Invoq queries the SubscriptionRegistry contract and
    returns the entitlement status in under 100 milliseconds via cached
    state.

5.  As the customer uses the product, Invoq\'s usage metering system
    increments their request counter in real time. If they approach
    their plan limit, Invoq fires a threshold webhook to the
    developer\'s backend.

6.  On renewal date, the BillingCycle contract automatically debits the
    customer\'s wallet via Soroban SAC transfer. No human action
    required. Funds settle on Stellar in approximately 5 seconds.

7.  A payment_renewed webhook fires to the developer\'s backend. The
    developer\'s dashboard shows updated MRR. The customer\'s
    subscription continues uninterrupted.

8.  If a payment fails (insufficient balance), the contract enters a
    grace period. A payment_failed webhook fires. After the grace period
    expires, the subscription is downgraded to a free tier or cancelled,
    and a subscription_cancelled webhook fires.

**5. Product Features**

**5.1 Subscription plan management**

Developers define their pricing model through the Invoq dashboard or
API. Invoq supports the full range of pricing structures used by modern
SaaS and API businesses:

-   Flat-rate plans: a fixed monthly or annual USDC amount for access to
    a defined feature set

-   Tiered plans: Free, Pro, and Enterprise tiers with different usage
    limits and feature flags

-   Usage-based plans: charge per API call, per token generated, per
    task completed, or per data record processed

-   Hybrid plans: a flat monthly base fee combined with a usage charge
    for overages

-   Trial periods: a configurable free trial before the first billing
    event

-   Annual billing with monthly billing equivalents for pricing display

-   Coupons and promotional discounts encoded directly into plan
    parameters

**5.2 Customer and subscription lifecycle**

Invoq manages the full customer lifecycle, from first subscription
through cancellation and reactivation:

-   Customer creation and wallet association on first subscription

-   Plan upgrades and downgrades with prorated billing calculations

-   Subscription pause and resume with configurable billing behavior
    during pause

-   Cancellation at end of period or immediate with partial refund via
    EscrowVault

-   Automatic reactivation when a lapsed customer re-subscribes

-   Customer portal: a hosted page developers can link to, allowing
    customers to manage their own subscription without developer
    intervention

**5.3 Usage metering and quota enforcement**

Invoq provides a real-time usage metering system that developers can
feed API call counts, token counts, or any custom numeric metric into
via a single API call. The system handles:

-   Per-customer, per-plan usage counters that reset on billing cycle
    boundaries

-   Configurable hard limits that reject requests over quota and soft
    limits that fire threshold webhooks

-   Usage rollover policies --- unused quota can expire or carry forward
    to the next period

-   Aggregated usage reports per customer, per plan, and per time period
    available in the dashboard and via API

**5.4 Webhook and event system**

Every significant billing event fires a signed webhook to the
developer\'s configured endpoint. Invoq guarantees at-least-once
delivery with exponential backoff retry logic. Webhook payloads are
signed with an HMAC key so developers can verify authenticity.

  ------------------------- ----------------------------------------------
  **Event**                 **Fires when**

  subscription.created      A customer successfully subscribes to a plan
                            for the first time

  payment.renewed           A billing cycle renews and payment settles
                            successfully on-chain

  payment.failed            A renewal payment attempt fails due to
                            insufficient wallet balance

  subscription.cancelled    A subscription is cancelled by the customer or
                            by the system after grace period expiry

  subscription.upgraded     A customer moves to a higher plan tier

  subscription.downgraded   A customer moves to a lower plan tier,
                            including grace period downgrade

  usage.threshold           A customer\'s usage reaches a configured
                            percentage of their plan limit

  trial.ending              A customer\'s trial period ends within 72
                            hours

  vault.low_balance         An EscrowVault balance falls below the
                            configured auto-top-up threshold
  ------------------------- ----------------------------------------------

**5.5 Developer SDKs**

Invoq ships official SDKs for the two languages most commonly used by AI
developers:

-   JavaScript / TypeScript SDK published to npm. Supports both Node.js
    backends and browser-based applications. Full TypeScript typings
    included. Tree-shakeable ESM and CommonJS builds.

-   Python SDK published to PyPI. Async-first design with asyncio
    support. Compatible with FastAPI, Django, and Flask. Includes
    Pydantic models for all response types.

Both SDKs are designed for minimal setup: initialize with an API key,
and every platform operation is a single function call. Developers do
not need to understand Soroban, Stellar, or USDC to integrate Invoq.

**5.6 Developer dashboard**

The Invoq developer dashboard is a Next.js web application that gives
subscription businesses a real-time view of their billing operations. It
is the human interface to everything the API and contracts manage
automatically.

Key dashboard capabilities include:

-   Revenue overview: MRR, ARR, net new MRR, churned MRR, and expansion
    MRR --- the standard SaaS revenue metrics, all settled in USDC

-   Customer list with subscription status, plan tier, usage, and
    payment history per customer

-   Plan management: create, edit, archive, and clone plans directly
    from the UI

-   Invoice history: every billing event with on-chain transaction hash
    for verification

-   Payout management: withdraw accumulated USDC to any Stellar address
    or trigger an off-ramp via MoneyGram or Bridge

-   Webhook log: every fired webhook with delivery status, payload, and
    retry history

-   Usage analytics: per-plan and per-customer usage charts with
    configurable time ranges

**6. Target Users and Use Cases**

**6.1 Primary users**

Invoq is built for developers who are building products that charge
recurring fees or usage-based fees to their customers. The common thread
is that they need more than a payment primitive --- they need billing
infrastructure.

  ------------------- ------------------------ ---------------------------
  **User type**       **What they build**      **What they need from
                                               Invoq**

  AI API developers   LLM inference APIs,      Usage-based billing per
                      embedding services,      token or per request, with
                      image generation         plan tiers and monthly caps
                      endpoints                

  SaaS developers     AI-powered writing       Monthly subscription plans
                      tools, productivity      with trial periods,
                      apps, automation         customer portal, and
                      platforms                webhook integrations

  Data providers      Financial data feeds,    Usage-metered access with
                      on-chain analytics,      enterprise invoicing and
                      real-time price APIs     payment net-30 support via
                                               EscrowVault

  MCP tool builders   Paid tools and skills    Hybrid billing: x402 for
                      exposed to AI agents via per-call access, Invoq for
                      Model Context Protocol   volume subscription plans
                                               for heavy users

  Developer tooling   Infrastructure services, Tiered plans targeting
  companies           monitoring tools, CI/CD  different team sizes with
                      platforms for Stellar    usage quotas per seat
                      developers               
  ------------------- ------------------------ ---------------------------

**6.2 Illustrative use cases**

**Use case A: AI inference API with tiered plans**

An independent AI developer has built a fine-tuned language model and
wants to monetize it via API. They define three plans in Invoq: a Free
tier with 10,000 tokens per month at no cost, a Pro tier at \$29/month
for 1 million tokens, and an Enterprise tier at \$199/month for
unlimited tokens. When a customer calls their API, the developer\'s
backend calls Invoq\'s checkEntitlement() to verify plan access and
recordUsage() to decrement their token quota. Billing is fully automated
--- Invoq renews subscriptions monthly, fires webhooks for payment
events, and the developer withdraws accumulated USDC from the dashboard.

**Use case B: AI agent marketplace with hybrid billing**

A developer has built a marketplace of tools that AI agents can purchase
access to. High-volume agents use x402 to pay per individual tool call.
Frequent users who call tools hundreds of times daily can subscribe to a
monthly Invoq plan that entitles them to a bundle of tool calls at a
discounted effective rate. Invoq verifies subscription entitlement
before each x402 charge, skipping the payment if the subscriber is
within their included quota. The two systems compose seamlessly.

**Use case C: Global data provider with enterprise billing**

A financial data company provides real-time Stellar on-chain analytics
to enterprise clients. Clients deposit USDC into Invoq\'s EscrowVault at
the start of each month. API usage draws down the balance in real time.
At month end, a detailed invoice is generated with per-endpoint usage
breakdowns and delivered to the enterprise client. If a client runs low
mid-month, an automated notification fires and the client tops up their
vault. The developer never handles individual payment requests --- Invoq
manages the entire billing relationship.

**7. Why Stellar**

**7.1 The infrastructure advantage**

Stellar is uniquely suited to host a subscription billing platform
because it combines three properties that no other blockchain currently
offers simultaneously: near-zero transaction costs, 5-second finality,
and a mature USDC ecosystem as a first-class native asset rather than a
bridged or wrapped token.

Subscription billing requires high-frequency recurring payments --- a
platform with 10,000 monthly subscribers renewing on staggered dates
processes thousands of payment events per day. On Ethereum mainnet, gas
costs alone would make this economically unviable. On Stellar, the cost
is negligible. Combined with Soroban\'s programmable contract layer and
99.99% uptime since launch, Stellar is the only chain where a
subscription billing product can operate reliably at scale without the
cost burden overwhelming the business model.

**7.2 Building on proven SDF investments**

Invoq does not require Stellar to build new infrastructure. It composes
directly on top of three existing SDF investments:

-   x402 on Stellar --- the per-request payment primitive that Invoq
    sits above and integrates with for hybrid billing models

-   Soroban --- the smart contract platform that provides the
    programmable, on-chain billing state that Invoq\'s contracts are
    deployed on

-   OpenZeppelin\'s Stellar smart account contracts --- the spend policy
    and account abstraction layer that Invoq\'s SpendPolicy contract
    composes with

Every Invoq transaction increases Soroban contract invocations and
Stellar USDC settlement volume --- the two metrics SDF prioritizes as
evidence of ecosystem health. Invoq is additive to the ecosystem, not
extractive.

**7.3 The real-world connectivity advantage**

Stellar\'s off-ramp network --- MoneyGram across 170+ countries and
Bridge in 150+ countries --- means that revenue earned by Invoq
developers can be withdrawn to local currency anywhere in the world. A
developer in India, Brazil, or Nigeria can build a subscription business
on Invoq and receive their USDC earnings as local currency without
needing a US bank account or going through a crypto exchange. This
global accessibility is a core part of Invoq\'s value proposition for
the developer communities Stellar is trying to grow.

**8. Technical Architecture**

**8.1 Technology stack**

  -------------------- -------------------- -------------------------------
  **Layer**            **Technology**       **Rationale**

  **Smart contracts**  Rust + Soroban SDK,  Native Stellar contract
                       WASM                 platform. Rust provides memory
                                            safety and deterministic
                                            execution critical for billing
                                            logic.

  **Backend API**      Node.js + Fastify    High-throughput, low-latency
                                            API framework. Native async
                                            support for concurrent webhook
                                            delivery.

  **Background jobs**  BullMQ + Redis       Reliable job queuing for
                                            renewal processing, webhook
                                            retry, and usage aggregation.

  **Primary database** MongoDB             Document structure fits developer,
                                            webhook, and billing cache state.
                                            Flexible schema for fast iteration.

  **Cache / state**    Redis                Sub-millisecond entitlement
                                            checks for high-frequency API
                                            usage. Usage counters
                                            incremented atomically.

  **Blockchain SDK**   Stellar SDK (JS +    Official SDKs for contract
                       Rust)                invocation, transaction
                                            submission, and event
                                            streaming.

  **Dashboard**        Next.js +            Server-side rendering for fast
                       TailwindCSS          initial load. React for
                                            interactive charts and
                                            real-time data updates.

  **Infrastructure**   Docker + Railway /   Containerized deployment for
                       Fly.io               consistent environments. Fly.io
                                            provides global edge presence
                                            for low-latency API access.
  -------------------- -------------------- -------------------------------

**8.2 Security model**

Invoq\'s security model is layered to protect both developers and their
customers:

-   All subscription state is stored on-chain in Soroban contracts. The
    Invoq backend cannot alter a subscription\'s status without
    executing a valid Stellar transaction signed by the contract\'s
    authority keys.

-   API keys are hashed before storage. No plaintext API keys are
    retained after initial generation.

-   Webhook payloads are signed with HMAC-SHA256 using a per-developer
    signing key. Developers can verify authenticity independently.

-   The Invoq platform is non-custodial for developer funds. USDC earned
    from subscriptions is held in the developer\'s own Stellar wallet,
    not in Invoq\'s custody. Withdrawal is a direct on-chain transaction
    to any Stellar address.

-   Soroban contracts will be audited by a qualified smart contract
    auditor before mainnet deployment, with the audit report published
    publicly as a requirement of the SCF milestone.

**9. Development Roadmap**

*Invoq will be built and delivered across four milestones over 16 weeks,
with SCF grant tranches tied to each milestone\'s completion.*

**Milestone 1 --- Soroban contract core (Weeks 1--3, 10% tranche)**

The first milestone establishes the on-chain foundation of Invoq. All
four Soroban contracts --- SubscriptionRegistry, BillingCycle,
SpendPolicy, and EscrowVault --- will be written in Rust, unit-tested
against the Soroban local sandbox, and deployed to Stellar Testnet. A
public architecture document and contract interface specification will
be published to GitHub at the close of this milestone, giving the SCF
panel and community full visibility into the on-chain design before
further development proceeds.

Deliverables: deployed Soroban contracts on Testnet, full unit test
suite, public GitHub repository, architecture specification document.

**Milestone 2 --- REST API and metering layer (Weeks 4--7, 20%
tranche)**

The second milestone builds the operational backend of the platform.
This includes the Node.js / Fastify REST API with endpoints for plan
creation, subscription management, entitlement checking, usage
recording, and customer management. The MongoDB data model and
Redis caching layer will be implemented. The BullMQ-based webhook
delivery system with retry logic will be built. Integration with x402
for hybrid billing scenarios --- where Invoq entitlement checks gate
x402 payment requirements --- will be completed and documented with a
working example.

Deliverables: fully functional REST API, webhook system, usage metering,
x402 integration example, API documentation.

**Milestone 3 --- Dashboard and SDKs (Weeks 8--12, 30% tranche)**

The third milestone delivers the developer-facing surface of the
platform. The Next.js developer dashboard will be built with all core
views: revenue overview, customer list, plan management, invoice
history, webhook log, and usage analytics. The JavaScript / TypeScript
SDK will be published to npm and the Python SDK to PyPI, each with
comprehensive documentation and quickstart guides. A minimum of three
external developers will be onboarded to use Invoq on Testnet, and their
integration feedback will be incorporated into the SDK and API design
before mainnet launch.

Deliverables: production-ready developer dashboard, JS and Python SDKs
published to package registries, documentation site, three confirmed
external integrations.

**Milestone 4 --- Mainnet launch (Weeks 13--16, 40% tranche)**

The fourth and final milestone takes Invoq to production. Soroban
contracts will undergo a professional security audit, with the audit
report published publicly. The full platform will be deployed to Stellar
mainnet. A live demonstration with verifiable USDC transaction volume
will be produced. A minimum of ten developers will have active Invoq
integrations processing real subscriptions. A detailed ecosystem blog
post documenting the build process, architecture decisions, and lessons
learned will be published on the Stellar community blog to benefit
future builders.

Deliverables: mainnet deployment, public security audit report, live
demo, 10+ developer integrations, ecosystem blog post.

**10. Ecosystem Impact**

**10.1 Direct impact on Stellar metrics**

Invoq\'s impact on the Stellar ecosystem is direct and measurable across
the metrics SDF tracks publicly:

  ---------------------- ------------------------------------------------
  **Metric**             **Invoq\'s contribution**

  **Soroban contract     Every entitlement check, usage record, and
  invocations**          billing event invokes Invoq\'s Soroban
                         contracts. A platform with 1,000 active
                         subscribers generates tens of thousands of
                         contract invocations per month.

  **Stellar USDC         Every subscription renewal and EscrowVault debit
  volume**               is a USDC transfer on Stellar. Invoq directly
                         increases the USDC settlement volume that SDF
                         measures as ecosystem health.

  **New developer        Invoq unlocks a category of developer --- SaaS
  adoption**             builders and API monetizers --- that currently
                         has no reason to build on Stellar. It creates a
                         pull factor for developers who have never
                         considered Stellar before.

  **x402 ecosystem       Invoq\'s hybrid billing model actively drives
  growth**               x402 adoption for free-tier usage, expanding the
                         x402 developer ecosystem at the same time.
  ---------------------- ------------------------------------------------

**10.2 Success metrics for the grant period**

The following measurable outcomes will be tracked and reported at the
close of the SCF grant period:

-   Number of developers with active Invoq integrations --- target: 10
    by mainnet launch, 50 by 90 days post-launch

-   Cumulative Stellar USDC transaction volume processed --- target:
    verifiable on-chain volume demonstrated at milestone 4

-   Number of Soroban contract invocations --- tracked via Stellar
    Horizon and reported in the ecosystem blog post

-   SDK downloads --- npm and PyPI download counts published
    transparently

-   Developer onboarding time --- measured from first SDK install to
    first successful subscription created; target under 30 minutes

**10.3 Long-term ecosystem vision**

Invoq\'s long-term vision is to become the default billing
infrastructure for any developer building a recurring-revenue product on
Stellar. As the Stellar ecosystem grows --- with more DeFi protocols,
more tokenized assets, and more AI agent infrastructure --- Invoq grows
with it. Future expansions that are not in scope for the SCF grant but
represent natural extensions include cross-chain subscription settlement
(allowing customers to pay from non-Stellar wallets), streaming
micropayment billing for per-second or per-token charging, and
enterprise invoicing features for net-30 and net-60 payment terms.

**11. Competitive Positioning**

**11.1 Invoq is not competing with x402**

The most important competitive positioning statement for Invoq is what
it is not. It is not a per-request payment protocol. It does not replace
x402 or MPP. It does not process individual API call payments. Invoq and
x402 operate at different layers of the stack and serve different
developer needs. The correct mental model is that x402 is to Invoq what
Stripe\'s payment processing is to Stripe Billing --- the former moves
money, the latter manages the business relationships, plans, and
lifecycle that determine when and how money should move.

**11.2 Comparison with off-chain alternatives**

  ------------------ ------------------- ------------------- -------------------
                     **Stripe Billing**  **Recurly /         **Invoq**
                                         Chargebee**         

  **Settlement**     Credit card / fiat  Credit card / fiat  **Stellar USDC
                                                             on-chain**

  **Agent-native**   No --- requires     No                  **Yes ---
                     human card                              wallet-based**

  **On-chain state** None                None                **Soroban
                                                             contracts**

  **x402             Via preview only    None                **Native hybrid
  integration**                                              support**

  **Global access**  Limited by banking  Limited by banking  **170+ country
                                                             off-ramp**

  **Transaction      2.9% + \$0.30       0.5--1% + Stripe    **Near-zero Stellar
  fees**                                 fees                fees**
  ------------------ ------------------- ------------------- -------------------

**11.3 The defensible position**

Invoq\'s competitive moat is not technical complexity --- it is deep
integration with the Stellar ecosystem. As the first subscription
billing platform native to Stellar, Invoq will accumulate integrations,
developer trust, and network effects that a later entrant would have to
rebuild from scratch. Being first on a growing blockchain ecosystem with
a well-executed product is a durable advantage.

**12. Funding Request**

**12.1 Grant amount**

Invoq is applying for a Stellar Community Fund Build Award of \$70,000
USD equivalent in XLM, to be distributed across four milestone tranches
as specified in the SCF Build Award structure.

  ------------------ ------------- ------------- --------------------------
  **Milestone**      **Tranche**   **Amount      **Completion criteria**
                                   (USD)**       

  M1 --- Soroban     10%           \$7,000       Contracts deployed to
  contracts                                      Testnet, repo public,
                                                 architecture doc published

  M2 --- API +       20%           \$14,000      REST API live, webhook
  metering                                       system functional, x402
                                                 integration example
                                                 published

  M3 --- Dashboard + 30%           \$21,000      Dashboard deployed, SDKs
  SDKs                                           published to npm and PyPI,
                                                 3 external integrations

  M4 --- Mainnet     40%           \$28,000      Mainnet live, security
  launch                                         audit published, 10+
                                                 integrations, ecosystem
                                                 post live
  ------------------ ------------- ------------- --------------------------

**12.2 How the funds will be used**

The grant will fund four months of full-time development by a solo
developer with Rust, Node.js, and Stellar ecosystem experience. The
primary cost categories are:

-   Development time: building and iterating on the four Soroban
    contracts, backend API, SDKs, and dashboard

-   Smart contract security audit: professional audit of the four
    Soroban contracts before mainnet deployment --- estimated
    \$3,000--\$5,000 of the total budget

-   Infrastructure costs: Fly.io hosting, MongoDB, Redis, and
    monitoring during development and initial production operations

-   Documentation and developer experience: technical writing,
    documentation site hosting, and SDK publication

**13. Conclusion**

Stellar has built exceptional per-request payment infrastructure. x402
and MPP are production-grade protocols backed by some of the most
credible organizations in technology. Soroban is a mature, secure,
developer-friendly smart contract platform. Stellar USDC is a real,
widely used stablecoin with a global off-ramp network.

What is missing is the layer that makes these primitives commercially
useful for the largest category of developer product: the
subscription-based business. Every SaaS developer, AI API provider, and
developer tool builder who wants to build a recurring-revenue product
needs billing management that goes beyond individual payment processing.
That layer does not yet exist on Stellar.

Invoq builds it. By composing directly on top of x402 and Soroban, Invoq
adds the missing piece to Stellar\'s agentic payment stack without
duplicating any existing work. It expands the ecosystem\'s addressable
market, increases USDC settlement volume, drives Soroban adoption, and
opens Stellar to a category of builder who has never had a reason to
build on-chain before.

> *The future of developer monetization is programmable, on-chain, and
> agent-native. Invoq makes that future accessible on Stellar, today.*

Invoq · SCF Build Award Application · May 2026

Built on x402 · Soroban · Stellar USDC
