import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { createTelegramBot, ProbeTelegramBot, startTelegramBot } from './adapters/telegram/index.js';
import { EnvConfig, getEnv, loadEnv } from './config/env.js';
import { MemoryCache } from './core/cache/memory-cache.js';
import { capabilityRegistry } from './core/capabilities/registry.js';
import { CreditBudgetManager } from './core/credit/budget-manager.js';
import { EvidenceExecutor } from './core/evidence/executor.js';
import { InvestigationManager, investigationManager as defaultManager } from './core/investigation/manager.js';
import { InvestigationOrchestrator } from './core/investigation/orchestrator.js';
import { createLLMProvider, ILLMProvider } from './core/llm/index.js';
import { NansenClient } from './core/nansen/client.js';
import { InvestigationPlanner } from './core/planner/planner.js';
import { EvidenceSynthesisEngine } from './core/synthesis/synthesizer.js';
import { TokenResolver } from './core/token/resolver.js';
import { DatabaseClient } from './database/client.js';
import { logger } from './utils/logger.js';

export interface BootstrapOptions {
  envOverrides?: Partial<Record<string, string>>;
  skipPolling?: boolean;
  isTest?: boolean;
}

export interface AppRuntime {
  env: EnvConfig;
  bot: ProbeTelegramBot;
  orchestrator: InvestigationOrchestrator;
  investigationManager: InvestigationManager;
  dbClient: DatabaseClient;
  stop: () => Promise<void>;
}

/**
 * Validates configuration required to run PROBE safely.
 * Never logs or returns secret values.
 */
export function validateRuntimeConfig(env: EnvConfig, isTest = false): void {
  if (!isTest) {
    if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === 'dummy_telegram_token_for_testing') {
      throw new Error(
        'Missing TELEGRAM_BOT_TOKEN. Please set TELEGRAM_BOT_TOKEN in your .env file or environment.'
      );
    }

    if (!env.NANSEN_API_KEY || env.NANSEN_API_KEY === 'dummy_nansen_key_for_testing') {
      throw new Error(
        'Missing NANSEN_API_KEY. Please set NANSEN_API_KEY in your .env file or environment.'
      );
    }

    if (env.LLM_PROVIDER !== 'mock' && !env.LLM_API_KEY) {
      throw new Error(
        `Missing LLM_API_KEY for provider '${env.LLM_PROVIDER}'. Please set LLM_API_KEY in your .env file or environment.`
      );
    }
  }
}

/**
 * Builds the complete PROBE runtime dependency graph:
 * NansenClient -> EvidenceExecutor -> InvestigationPlanner -> EvidenceSynthesisEngine -> InvestigationOrchestrator -> ProbeTelegramBot
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<AppRuntime> {
  const env = options.envOverrides ? loadEnv(options.envOverrides) : getEnv();

  // Validate configuration before spinning up resources
  validateRuntimeConfig(env, options.isTest);

  logger.info('PROBE starting...');

  // 1. Storage & Persistence
  const dbClient = new DatabaseClient(env.DATABASE_URL);
  await dbClient.connect();

  // 2. Cache
  const cache = new MemoryCache(env.CACHE_TTL_SECONDS);

  // 3. Credit Budget & Safety Controls
  const creditManager = new CreditBudgetManager({
    totalBudget: env.CREDIT_BUDGET_TOTAL,
    maxCallsPerTurn: env.CREDIT_MAX_CALLS_PER_TURN,
  });

  // 4. Intelligence Provider (Nansen)
  const nansenClient = new NansenClient({
    apiKey: env.NANSEN_API_KEY,
    baseUrl: env.NANSEN_BASE_URL,
  });

  // 5. LLM Provider (abstracted behind ILLMProvider)
  const llmProvider: ILLMProvider = createLLMProvider(env);

  // 6. Evidence Execution Engine (Phase 2A)
  const executor = new EvidenceExecutor({
    capabilityRegistry,
    nansenClient,
    creditManager,
    cache,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  });

  // 7. Investigation Planner (Phase 2B)
  const planner = new InvestigationPlanner({
    capabilityRegistry,
    llmProvider,
  });

  // 8. Evidence Synthesis Engine (Phase 2C)
  const synthesizer = new EvidenceSynthesisEngine({
    llmProvider,
  });

  // 9. Investigation State Management
  const investigationManager = defaultManager;

  // 10. Investigation Orchestrator (Phase 2D)
  const orchestrator = new InvestigationOrchestrator({
    planner,
    executor,
    synthesizer,
    investigationManager,
  });
  logger.info('Investigation engine initialized');

  // 11. Token Resolution Service
  const tokenResolver = new TokenResolver({
    nansenClient,
    cache,
  });

  // 12. Telegram Bot Transport Adapter (Phase 3A)
  const bot = createTelegramBot({
    botToken: env.TELEGRAM_BOT_TOKEN,
    orchestrator,
    investigationManager,
    tokenResolver,
  });
  logger.info('Telegram adapter initialized');

  let isStopping = false;
  const stop = async () => {
    if (isStopping) return;
    isStopping = true;
    logger.info('PROBE shutting down...');
    try {
      await bot.getBot().stop();
    } catch {
      // Safe stop
    }
    try {
      await dbClient.close();
    } catch {
      // Safe close
    }
    logger.info('PROBE stopped cleanly.');
  };

  // Start polling only if not skipped
  if (!options.skipPolling) {
    logger.info('Telegram polling started');
    startTelegramBot(bot).catch((err) => {
      logger.error('Fatal error in Telegram bot polling', { error: String(err) });
      stop().finally(() => process.exit(1));
    });
  }

  return {
    env,
    bot,
    orchestrator,
    investigationManager,
    dbClient,
    stop,
  };
}

let cachedRuntimePromise: Promise<AppRuntime> | null = null;

/**
 * Returns a cached AppRuntime instance for warm serverless execution.
 * Defaults to skipPolling: true to avoid starting the Telegram polling loop.
 */
export async function getOrInitRuntime(options: BootstrapOptions = { skipPolling: true }): Promise<AppRuntime> {
  if (!cachedRuntimePromise) {
    cachedRuntimePromise = bootstrap(options).catch((err) => {
      cachedRuntimePromise = null;
      throw err;
    });
  }
  return cachedRuntimePromise;
}

/**
 * Resets the cached runtime instance (useful for testing and graceful shutdown).
 */
export async function resetCachedRuntime(): Promise<void> {
  if (cachedRuntimePromise) {
    const runtime = await cachedRuntimePromise.catch(() => null);
    if (runtime) {
      await runtime.stop().catch(() => {});
    }
    cachedRuntimePromise = null;
  }
}

// Standalone execution entrypoint
const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
const isDirectExecution =
  !isTestEnv &&
  Boolean(
    process.argv[1] &&
      (path.resolve(process.argv[1]).toLowerCase() ===
        path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ||
        path.resolve(process.argv[1]).toLowerCase().endsWith('dist\\src\\index.js') ||
        path.resolve(process.argv[1]).toLowerCase().endsWith('dist/src/index.js'))
  );

if (isDirectExecution) {
  bootstrap()
    .then((runtime) => {
      const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Gracefully terminating PROBE...`);
        await runtime.stop();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`PROBE startup failed: ${msg}`);
      process.exit(1);
    });
}

