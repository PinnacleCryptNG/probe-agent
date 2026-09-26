import { z } from 'zod';
import dotenv from 'dotenv';
import { PROBE_CONSTANTS } from './constants.js';

// Load .env file
dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Nansen API
  NANSEN_API_KEY: z.string().min(1, 'NANSEN_API_KEY is required').default('dummy_nansen_key_for_testing'),
  NANSEN_BASE_URL: z.string().url().default('https://api.nansen.ai'),

  // Credit Budget
  CREDIT_BUDGET_TOTAL: z.coerce.number().int().positive().default(PROBE_CONSTANTS.DEFAULT_TOTAL_BUDGET),
  CREDIT_MAX_CALLS_PER_TURN: z.coerce.number().int().positive().default(PROBE_CONSTANTS.DEFAULT_MAX_CALLS_PER_TURN),

  // Cache
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(PROBE_CONSTANTS.DEFAULT_CACHE_TTL_SECONDS),
  REDIS_URL: z.string().optional(),

  // Storage
  DATABASE_URL: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional().default('dummy_telegram_token_for_testing'),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  VERCEL_WEBHOOK_URL: z.string().optional(),

  // LLM Provider
  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai', 'gemini']).default('mock'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('default-model'),

  // Log level
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

let parsedEnv: EnvConfig;

export function loadEnv(overrides?: Partial<Record<string, string>>): EnvConfig {
  const envToParse = {
    CREDIT_BUDGET_TOTAL: process.env.CREDIT_BUDGET_TOTAL ?? process.env.TOTAL_NANSEN_CREDIT_BUDGET,
    CREDIT_MAX_CALLS_PER_TURN: process.env.CREDIT_MAX_CALLS_PER_TURN ?? process.env.MAX_NANSEN_CALLS_PER_TURN,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS ?? process.env.CACHE_DEFAULT_TTL_SECONDS,
    LLM_API_KEY: process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY,
    ...process.env,
    ...overrides,
  };

  const result = EnvSchema.safeParse(envToParse);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorDetails}`);
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export function getEnv(): EnvConfig {
  if (!parsedEnv) {
    return loadEnv();
  }
  return parsedEnv;
}
