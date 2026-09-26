# PROBE

> **Investigate the chain. Interrogate the evidence.**  
> *Evidence-first conversational on-chain investigation agent.*

PROBE is an autonomous on-chain intelligence agent built for Telegram. Unlike conversational bots that echo unverified social sentiment or generate speculative market forecasts, PROBE functions like a forensic analyst: it constructs structured investigation plans, queries verified on-chain telemetry through the Nansen API, tracks provenance on every datum, and strictly separates observable facts from interpretations.

Users can interrogate findings through a dedicated **Challenge Mode**, forcing the agent to stress-test its conclusions, surface unproven assumptions, and establish discriminating criteria against competing hypotheses.

---

## Table of Contents

- [The Investigation Workflow](#the-investigation-workflow)
- [Evidence-First Epistemic Framework](#evidence-first-epistemic-framework)
- [Challenge Mode](#challenge-mode)
- [Key Capabilities](#key-capabilities)
- [Telegram Bot Interface & Usage](#telegram-bot-interface--usage)
- [System Architecture](#system-architecture)
- [Nansen Intelligence Integration](#nansen-intelligence-integration)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Testing & Validation](#testing--validation)
- [Deployment Architecture (Vercel + Telegram Webhook)](#deployment-architecture-vercel--telegram-webhook)
- [Security & Hygiene](#security--hygiene)
- [Current Project Status](#current-project-status)
- [Roadmap](#roadmap)

---

## The Investigation Workflow

Every interaction with PROBE follows a deterministic, bounded seven-step lifecycle:

```
┌───────┐     ┌────────┐     ┌─────────────┐     ┌──────────┐
│  ASK  │ ──► │  PLAN  │ ──► │ INVESTIGATE │ ──► │ EVIDENCE │
└───────┘     └────────┘     └─────────────┘     └──────────┘
                                                       │
┌───────────┐     ┌───────────┐     ┌────────┐         │
│ FOLLOW UP │ ◄── │ CHALLENGE │ ◄── │ ANSWER │ ◄───────┘
└───────────┘     └───────────┘     └────────┘
```

1. **ASK**: The user introduces a token context (symbol or contract address on Ethereum, Solana, or EVM chains) and asks a natural-language question or selects an investigation shortcut.
2. **PLAN**: The `InvestigationPlanner` classifies user intent, inspects credit budgets, checks chain compatibility, and derives an execution plan with a bounded set of Nansen capability calls.
3. **INVESTIGATE**: The `EvidenceExecutor` runs planned capabilities against Nansen endpoints, honoring cache policies and deduplication rules while decrementing credits.
4. **EVIDENCE**: Raw responses are normalized into immutable, typed `EvidenceItem` records tagged with provenance metadata and epistemic classification (`OBSERVATION`).
5. **ANSWER**: The `EvidenceSynthesisEngine` constructs a scannable Telegram response structured into Headlines, Key Observations, Analytical Interpretation, Evidence Provenance, and Disclosed Unknowns. An `EvidenceValidator` audits the output to block hallucinated causality.
6. **CHALLENGE**: The user can challenge any conclusion (e.g., *"Are you sure it was whales?"* or *"Could this be internal transfers?"*). The `ChallengeSynthesizer` evaluates the claim, separating evidence status from interpretation status.
7. **FOLLOW UP**: State is maintained across turns for the active token, allowing seamless iterative investigations.

---

## Evidence-First Epistemic Framework

PROBE is designed around epistemological rigor. It enforces strict distinctions between empirical data and analytical deductions:

| Category | Definition | Example in Output |
| :--- | :--- | :--- |
| **Observation** | Empirically verified fact directly grounded in on-chain telemetry. | `• Fresh wallets: +$830.13M net flow` |
| **Interpretation** | Analytical inference explaining the potential cause or meaning of observations. | `Substantial fresh-wallet inflows observed during the window.` |
| **Hypothesis** | Plausible explanation or scenario consistent with the current evidence. | `Smart Money accumulation preceding exchange outflow.` |
| **Not Proven / Unknown** | Explicit disclosure of what the available data *cannot* verify. | `• Counterparty intent or private OTC trades cannot be proven.` |
| **Provenance** | Complete audit trail attached to each finding (endpoint, parameters, latency, cost). | `evi_e2c301ec-71a7-4c90-a2f0-c783ca293e6b` (`flow_intelligence`) |

---

## Challenge Mode

When users question or dispute a finding, PROBE transitions into **Challenge Mode**. Rather than stubbornly defending its initial statement or blindly agreeing, PROBE performs an adversarial audit of its own claims:

### Challenge Categories Detected
- **`EVIDENCE_CHALLENGE`**: Inquiring whether specific evidence truly supports the statement (*"What evidence proves whales were selling?"*).
- **`ALTERNATIVE_EXPLANATION`**: Proposing an alternate scenario (*"Could this just be exchange rebalancing?"*).
- **`CONTRADICTION`**: Pointing out conflicting signals (*"Why are holders down if fresh wallets are buying?"*).
- **`CERTAINTY`**: Questioning confidence levels (*"Are you certain that was dumping?"*).
- **`FALSIFICATION`**: Exploring what would disprove the thesis (*"What would prove this wasn't an OTC deal?"*).

### Separation of Evidence vs. Interpretation
PROBE explicitly distinguishes the factual observation from the narrative inference:

- **Evidence Status**: `SUPPORTED` \| `CONTRADICTED` \| `INSUFFICIENT`
- **Interpretation Status**: `SUPPORTED` \| `PARTIALLY_SUPPORTED` \| `UNSUPPORTED` \| `NOT_APPLICABLE`
- **Discriminating Criteria**: Identifies what the evidence establishes, what it does **not** establish, and what exact on-chain telemetry would test or falsify the alternative hypothesis.

---

## Key Capabilities

PROBE integrates 14 specialized blockchain intelligence capabilities registered in `src/core/capabilities/registry.ts`:

| Capability Name | Nansen Endpoint | Credit Cost | Description |
| :--- | :--- | :---: | :--- |
| `token_search` | `/api/v1/search/general` | 0 | Resolves symbols, names, and contract addresses across chains. |
| `token_information` | `/api/v1/tgm/token-information` | 1 | Spot price, 24h volume, market cap, and holder counts. |
| `flow_intelligence` | `/api/v1/tgm/flow-intelligence` | 1 | Net flows across cohorts (Whales, Smart Money, Fresh Wallets, Exchanges). |
| `who_bought_sold` | `/api/v1/tgm/who-bought-sold` | 1 | Top accumulators and net sellers over a specified timeframe. |
| `token_transfers` | `/api/v1/tgm/transfers` | 1 | Granular on-chain token transfer transactions with USD filters. |
| `dex_trades` | `/api/v1/tgm/dex-trades` | 1 | DEX swap events and liquidity pool executions. |
| `historical_flows` | `/api/v1/tgm/flows` | 1 | Time-series historical inflows, outflows, and net flows. |
| `token_holders` | `/api/v1/tgm/holders` | 5 | Holder concentration, distribution percentiles, and top wallets. |
| `wallet_current_balance` | `/api/v1/profiler/address/current-balance` | 1 | Real-time token portfolio and USD holdings for an address. |
| `wallet_transactions` | `/api/v1/profiler/address/transactions` | 1 | Historical transactions executed by a wallet *(EVM only; unsupported on Solana)*. |
| `wallet_related` | `/api/v1/profiler/address/related-wallets` | 1 | Entity clustering and co-controlled wallet heuristics. |
| `wallet_first_funder` | `/api/v1/profiler/address/first-funder` | 1 | Identifies the wallet or exchange that initially supplied gas funding. |
| `wallet_counterparties` | `/api/v1/profiler/address/counterparties` | 5 | Top contracts and addresses transacting with a target wallet. |
| `transaction_deep_dive` | `/api/v1/transaction-with-token-transfer-lookup` | 2 | Comprehensive transaction receipt with all internal transfers. |

### Credit Safety & Budget Management
- **Account Budget Tracking**: Defaults to an operational ceiling of `1100` credits.
- **Turn Ceiling**: Hard cap of `4` endpoint invocations per conversational turn to prevent runaway loops.
- **In-Memory Query Cache**: 5-minute TTL (`CACHE_TTL_SECONDS=300`) to eliminate duplicate endpoint billing during active investigation sessions.

---

## Telegram Bot Interface & Usage

PROBE uses a **token-first** conversational flow designed to minimize ambiguity and avoid hallucinations.

### 1. Bot Commands
- `/start` — Displays the introductory banner and prompts the user to submit a token symbol or address.
- `/help` — Outlines PROBE's evidence-based architecture and command guidelines.
- `/new` — Clears the active chat session context to begin an investigation on a new token.

### 2. Supported Token Formats
- **EVM Addresses**: `0x...` (40 hexadecimal characters) across Ethereum, Base, Arbitrum, Polygon, BNB, etc.
- **Solana Addresses**: Base58 public keys (32–44 characters), e.g. `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (BONK).
- **Symbols**: `ETH`, `SOL`, `BONK`, `USDC`, `WETH`, etc. If a symbol is ambiguous across chains, PROBE prompts: *"Which chain? • ethereum • base • solana"*.
- **Chain-Only Detection**: If a user enters only a chain name (e.g., *"Solana"*), PROBE prompts: *"Which token on solana? Send the token symbol or contract address."*

### 3. Investigation Shortcuts
Once a token is resolved, PROBE provides an interactive keyboard with one-tap shortcuts:
- `What's happening?`
- `Who is buying?`
- `Who is selling?`
- `Biggest transactions`

### 4. Realistic Interaction Examples

#### Standard Investigation Turn
```text
User: ETH
PROBE: 🔎 ETH
       What do you want to investigate?
       [What's happening?] [Who is buying?]
       [Who is selling?]   [Biggest transactions]

User: What's happening?
PROBE: 🔎 ETH — What's happening?

       Fresh-wallet and exchange activity are the clearest signals in the available data.

       • Fresh wallets: +$830.13M net flow
       • Exchanges: -$352.77M
       • Smart Money / Top PnL: -$0.10M
       • Whales: -$14.81K

       This points to substantial fresh-wallet inflows during the observed period,
       while whale cohort data shows minor net movement.

       Evidence
       • Cohort net flows
       • Top buyer/seller data
       • ETH/WETH token metrics

       Not Proven
       • The ultimate counterparty intent behind exchange outflows cannot be verified on-chain.

       Ask another question about ETH.
       Suggested: "Who is buying?" • "Who is selling?"
```

#### Challenge Mode Turn
```text
User: Are you sure it was whales selling? Could it just be internal transfers?
PROBE: 🔎 Challenge — ETH

       Original finding
       Whales: -$14.81K net flow

       Evidence
       SUPPORTED
       • Cohort flow intelligence shows -$14,805 net outflow for tagged whale addresses.

       Interpretation
       PARTIALLY SUPPORTED
       • The observed metrics are empirically verified from on-chain telemetry.
       • The underlying reason for the balance change remains unproven.

       Why it is supported
       • Cohort flow intelligence shows -$14,805 net outflow for tagged whale addresses.

       What is NOT proven
       • Whether the transfer was an OTC sale, a custody migration, or internal wallet rebalancing.

       Alternative: Internal Wallet Rebalancing
       • What would prove rebalancing: Cluster telemetry showing recipient addresses belong to the same entity.
       • What would disprove rebalancing: Direct deposit into CEX hot wallets or DEX swap executions.

       Verdict
       PARTIALLY SUPPORTED

       The balance reduction is verified on-chain; however, labeling it definitively as "dumping"
       overreaches the available evidence.
```

---

## System Architecture

```
                                  TELEGRAM USER
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │           Transport Layer            │
                     │  • grammY Polling (Local Dev)        │
                     │  • api/webhook.ts (Vercel Serverless)│
                     └──────────────────┬───────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │          Investigation Core          │
                     │  • InvestigationOrchestrator         │
                     │  • InvestigationManager (State)      │
                     │  • CreditBudgetManager (Safety)      │
                     └───────┬──────────────────────┬───────┘
                             │                      │
                             ▼                      ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│           Planning Layer             │   │            Synthesis Layer           │
│  • InvestigationPlanner              │   │  • EvidenceSynthesisEngine           │
│  • CapabilitySelector                │   │  • EvidenceValidator                 │
│  • TokenResolver (EVM / Solana)      │   │  • ChallengeSynthesizer              │
└──────────────────┬───────────────────┘   └──────────────────▲───────────────────┘
                   │                                          │
                   ▼                                          │
┌──────────────────────────────────────┐                      │
│           Execution Layer            │                      │
│  • EvidenceExecutor                  │                      │
│  • MemoryCache (5 min TTL)           │ ─────────────────────┘
│  • NansenClient (REST API)           │   (Typed Normalized EvidenceItems)
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│          Persistence Layer           │
│  • DatabaseClient (PostgreSQL Pool)  │
│  • Auto-fallback to In-Memory store  │
└──────────────────────────────────────┘
```

---

## Nansen Intelligence Integration

PROBE communicates directly with the official Nansen REST API (`https://api.nansen.ai`).

- **Authentication**: Custom HTTP header `api-key: <NANSEN_API_KEY>`.
- **Attribution**: Transparently complies with Nansen data redistribution policies by labeling evidence categories and providing Nansen attribution footers.
- **Endpoint Handling**: Full query typing with Zod schemas for pagination, timeframe normalization (`5m`, `1h`, `6h`, `12h`, `1d`, `7d`), and ISO date range defaults (`from`, `to`).
- **Chain Normalization**: Automatically maps heterogeneous chain identifiers (e.g. `solana`, `ethereum`, `base`, `arbitrum`) to Nansen-compatible parameter formats.

---

## Tech Stack

PROBE's stack is derived strictly from [package.json](file:///c:/Users/ayomi/OneDrive/Desktop/Probe%20Build/package.json) and production source files:

- **Language & Runtime**: Node.js (ES Modules, Node 22+) with TypeScript (`v5.7.3`, strict mode enabled).
- **Bot Framework**: grammY (`v1.35.0`) — chosen for modern TypeScript-first architecture, clean middleware pipelines, and native support for both long-polling and serverless webhooks.
- **Data Validation**: Zod (`v3.24.2`) — enforces strict runtime validation on all Nansen API inputs, environment variables, and execution plans.
- **Database & Storage**: `pg` (`v8.13.3`) — PostgreSQL connection pool with automated graceful fallback to in-memory storage if a database is not provisioned.
- **Testing**: Vitest (`v3.0.7`) — test runner executing 162 unit, smoke, and integration tests across 10 test suites.
- **Development & Tooling**:
  - `tsx` (`v4.19.3`) for rapid development and script execution without pre-compilation.
  - ESLint (`v9.21.0`) with `@typescript-eslint` for static analysis and code quality.
  - `dotenv` (`v16.4.7`) for local environment configuration.
- **Deployment**: Vercel Serverless Function architecture (`api/webhook.ts` + `vercel.json`).

---

## Project Structure

```text
probe-agent/
├── .env.example                     # Environment template (placeholders only)
├── .gitignore                       # Strict Git hygiene (ignores secrets & builds)
├── api/
│   └── webhook.ts                   # Vercel Serverless Function for Telegram webhook
├── eslint.config.js                 # ESLint flat configuration
├── package.json                     # Project manifest, scripts, and dependencies
├── tsconfig.json                    # TypeScript compiler configuration (ESNext, NodeNext)
├── vercel.json                      # Vercel deployment configuration (60s maxDuration)
├── vitest.config.ts                 # Vitest test configuration
├── scripts/
│   ├── diagnose-token.ts            # Token resolution & live Nansen diagnostic utility
│   ├── inspect-reports.js           # Verification helper script
│   ├── run-phase4b-live-tests.ts    # Live integration test runner
│   ├── run-phase4c-live-tests.ts    # Live multi-turn test runner
│   ├── run-phase5-live-tests.ts     # Live challenge mode test runner
│   ├── run-phase5b-live-tests.ts    # Live challenge quality test runner
│   └── set-webhook.ts               # Telegram setWebhook deployment helper
├── src/
│   ├── index.ts                     # Runtime bootstrap & entrypoint (dual-mode)
│   ├── adapters/
│   │   └── telegram/                # Telegram bot adapter
│   │       ├── bot.ts               # Bot lifecycle, routing, and message handler
│   │       ├── formatter.ts         # Telegram markdown formatting & message splitting
│   │       ├── index.ts             # Adapter entrypoint
│   │       ├── keyboard.ts          # Interactive inline keyboards & shortcuts
│   │       ├── messages.ts          # Standard message templates
│   │       └── token-extractor.ts   # Regex-based EVM/Solana/symbol extractor
│   ├── config/
│   │   ├── constants.ts             # Operational bounds, costs, and supported chains
│   │   └── env.ts                   # Zod-validated environment parser
│   ├── core/
│   │   ├── cache/                   # In-memory query caching (5-minute TTL)
│   │   ├── capabilities/            # 14 capability definitions and chain mappings
│   │   ├── challenge/               # Challenge Mode detector, synthesizer, formatter
│   │   ├── credit/                  # Centralized credit budget & safety manager
│   │   ├── evidence/                # Evidence executor, normalizer, provenance
│   │   ├── investigation/           # Investigation orchestrator & state machine
│   │   ├── llm/                     # Abstracted ILLMProvider (Mock, Gemini, OpenAI)
│   │   ├── nansen/                  # Typed Nansen API HTTP client
│   │   ├── planner/                 # Intent classification & capability selection
│   │   ├── synthesis/               # Evidence synthesis engine & causal validator
│   │   └── token/                   # Multi-strategy token resolution (EVM & Solana)
│   ├── database/
│   │   ├── client.ts                # PostgreSQL pool with in-memory fallback
│   │   └── schema.sql               # Relational investigation schema
│   ├── types/                       # TypeScript domain, evidence, and error interfaces
│   └── utils/                       # Secure ID generation and sanitized logger
└── tests/                           # 10 test suites covering all architectural layers
    ├── adapters/telegram/           # Bot routing & Vercel webhook unit tests
    ├── core/challenge/              # Challenge mode & falsification test suites
    ├── core/evidence/               # Evidence executor & normalizer tests
    ├── core/investigation/          # Orchestrator & live mock tests
    ├── core/planner/                # Planning & capability selection tests
    ├── core/synthesis/              # Synthesis engine & validator tests
    ├── core/token/                  # Solana & EVM address matrix resolution tests
    └── smoke/                       # End-to-end runtime wiring smoke tests
```

---

## Local Development Setup

### Prerequisites
- Node.js 22.x or later
- npm 10.x or later
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A Nansen API Key from [Nansen Query API](https://app.nansen.ai/api)

### 1. Clone & Install
```bash
git clone https://github.com/PinnacleCryptNG/probe-agent.git
cd probe-agent
npm install
```

### 2. Configure Environment
Copy the template to `.env`:
```bash
cp .env.example .env
```
Open `.env` and fill in your actual credentials (see [Environment Variables](#environment-variables)).

### 3. Start Local Development
Start the agent in long-polling mode with live file watching:
```bash
npm run dev
```

You should see:
```text
{"level":"INFO","message":"PROBE starting..."}
{"level":"INFO","message":"Investigation engine initialized"}
{"level":"INFO","message":"Telegram adapter initialized"}
{"level":"INFO","message":"Telegram polling started"}
```
Open Telegram, search for your bot username, and send `/start` to begin investigating.

---

## Environment Variables

All variables are validated on startup via Zod in `src/config/env.ts`.

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `NANSEN_API_KEY` | **Yes** | — | Nansen API key (`nsn_...`). |
| `TELEGRAM_BOT_TOKEN` | **Yes** | — | Telegram Bot token from @BotFather (`123456:ABC...`). |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `production`, `test`). |
| `PORT` | No | `3000` | HTTP port for server runtime. |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`). |
| `NANSEN_BASE_URL` | No | `https://api.nansen.ai` | Base URL for Nansen Query API. |
| `CREDIT_BUDGET_TOTAL` | No | `1100` | Account credit safety budget ceiling. |
| `CREDIT_MAX_CALLS_PER_TURN` | No | `4` | Maximum Nansen endpoint calls per turn. |
| `CACHE_TTL_SECONDS` | No | `300` | Evidence cache TTL in seconds (5 minutes). |
| `DATABASE_URL` | No | — | PostgreSQL connection string. *If omitted, PROBE runs in in-memory persistence mode.* |
| `REDIS_URL` | No | — | Optional Redis URI for distributed caching. |
| `TELEGRAM_WEBHOOK_SECRET` | No | — | Secret token for validating `X-Telegram-Bot-Api-Secret-Token` on Vercel. |
| `VERCEL_WEBHOOK_URL` | No | — | Public URL of the Vercel deployment (used by `scripts/set-webhook.ts`). |
| `LLM_PROVIDER` | No | `mock` | Synthesis LLM provider: `mock`, `gemini`, or `openai`. |
| `LLM_API_KEY` | Conditional | — | API key for Gemini or OpenAI (required if `LLM_PROVIDER` != `mock`). |
| `LLM_MODEL` | No | — | Model identifier (e.g., `gemini-2.5-flash` or `gpt-4o-mini`). |

> **Security Reminder**: Never commit `.env` or paste live API keys into tickets, issues, or pull requests.

---

## Testing & Validation

PROBE includes a test suite covering unit behavior, integration wiring, and edge cases:

```bash
# Run all 10 Vitest test suites (162 unit & integration tests)
npm test

# Run tests in interactive watch mode
npm run test:watch

# Validate TypeScript typing without emitting JavaScript
npm run typecheck

# Execute ESLint static analysis across all source code
npm run lint

# Compile production bundle to dist/
npm run build

# Run live token resolution & Nansen diagnostic script
npm run diagnose
```

### Test Suite Coverage Overview
- `tests/core/token/`: Comprehensive EVM & Solana address validation, symbol disambiguation, and multi-strategy resolution tests.
- `tests/core/planner/`: Intent extraction, budget bounds, and chain-specific capability selection tests.
- `tests/core/evidence/`: Mocked execution, response normalization, and provenance tracking tests.
- `tests/core/synthesis/`: Structural layout enforcement and anti-hallucination validation tests.
- `tests/core/challenge/`: Challenge intent classification, falsification layout, and verdict separation tests.
- `tests/adapters/telegram/bot.test.ts`: Telegram command routing, session context, and keyboard interaction tests.
- `tests/adapters/telegram/webhook.test.ts`: Vercel serverless request adaptation, secret token verification, and payload parsing tests.
- `tests/smoke/runtime.test.ts`: End-to-end runtime bootstrap and full turn execution smoke tests.

---

## Deployment Architecture (Vercel + Telegram Webhook)

PROBE supports a dual-mode transport architecture:

1. **Local Mode**: Uses grammY long-polling (`startTelegramBot`). Ideal for local development, zero port-forwarding requirements, and rapid iteration.
2. **Production Mode**: Uses an HTTPS webhook hosted on Vercel Serverless Functions (`api/webhook.ts`).

### Vercel Serverless Design
- **Entrypoint**: `api/webhook.ts` acts as the serverless function handler (`/api/webhook`).
- **Warm Instance Caching**: Uses `getOrInitRuntime({ skipPolling: true })` in `src/index.ts` to instantiate the application graph once per warm serverless container, avoiding cold-start overhead on consecutive updates.
- **Dual Body Parsing**: Custom grammY adapter handles both pre-parsed JSON bodies and raw streaming request payloads.
- **Execution Limit**: Configured in `vercel.json` with `maxDuration: 60` to ensure deep multi-endpoint investigations complete safely within serverless timeouts.
- **Secret Verification**: Validates incoming `X-Telegram-Bot-Api-Secret-Token` headers against `TELEGRAM_WEBHOOK_SECRET` to reject spoofed requests with `401 Unauthorized`.

### Registering the Webhook
Once deployed to Vercel, the Telegram webhook is registered with one command:
```bash
# Ensure TELEGRAM_BOT_TOKEN and VERCEL_WEBHOOK_URL are configured in your environment
npx tsx scripts/set-webhook.ts
```

---

## Security & Hygiene

- **Zero Secret Commits**: Git is configured to ignore `.env`, `.env.*`, `.vercel`, credentials, and logs. Only sanitized template files ([`.env.example`](file:///c:/Users/ayomi/OneDrive/Desktop/Probe%20Build/.env.example)) are tracked.
- **Sanitized Logging**: The internal logger in `src/utils/logger.ts` redacts authorization headers, API keys, and sensitive tokens. Errors presented to users never leak internal stack traces or URLs.
- **Graceful Failure**: If database connections or external services become unreachable, PROBE fails safely to in-memory mode rather than crashing.
- **Attribution & Terms Compliance**: Transparently labels on-chain data with Nansen attribution in accordance with Nansen API data redistribution guidelines.

---

## Current Project Status

- [x] **Phase 1**: Token Resolution & Multi-Chain Normalization (EVM + Solana).
- [x] **Phase 2**: Core Intelligence Engine (Planner, Executor, Synthesizer, Validator).
- [x] **Phase 3**: Telegram Transport Adapter (grammY, token-first UX, interactive keyboards).
- [x] **Phase 4**: Epistemic Synthesis & Multi-Turn Context Retention.
- [x] **Phase 5**: Challenge Mode Architecture & Falsification Quality Hardening.
- [x] **Deployment Preparation**: Vercel Serverless Webhook (`api/webhook.ts`) and registration automation.
- [x] **Repository Verification**: 100% test pass rate (162 tests), clean TypeScript build, and clean Git initial commit on `PinnacleCryptNG/probe-agent`.

---

## Roadmap

- [ ] **Vercel Production Deployment**: Deploy serverless endpoint to Vercel and execute `scripts/set-webhook.ts`.
- [ ] **Managed Cloud Database**: Attach a persistent PostgreSQL instance (e.g., Neon or Supabase) to replace in-memory session persistence.
- [ ] **Live LLM Synthesis Integration**: Connect production Gemini 2.5 Flash / OpenAI models for enhanced natural language explanation while preserving deterministic evidence grounding.
- [ ] **Expanded Non-EVM Support**: Add deeper protocol-level parsing for Solana DEXs and cross-chain bridges as Nansen endpoints expand.
