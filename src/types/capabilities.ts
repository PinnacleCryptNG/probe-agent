import { z } from 'zod';

export const CapabilityNameSchema = z.enum([
  'token_search',
  'token_information',
  'flow_intelligence',
  'who_bought_sold',
  'token_transfers',
  'dex_trades',
  'historical_flows',
  'token_holders',
  'wallet_current_balance',
  'wallet_transactions',
  'wallet_related',
  'wallet_first_funder',
  'wallet_counterparties',
  'transaction_deep_dive',
]);

export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

export interface CapabilityDefinition<TInput = Record<string, unknown>, TOutput = unknown> {
  name: CapabilityName;
  description: string;
  endpoint: string;
  httpMethod: 'POST';
  creditCost: number;
  enabledForMvp: boolean;
  supportedChains: readonly string[] | 'ALL';
  unsupportedChains?: readonly string[];
  requiresToken: boolean;
  requiresAddress: boolean;
  inputSchema: z.ZodType<TInput>;
  defaultLimits?: {
    maxRecords?: number;
    defaultDays?: number;
  };
  transformOutput?: (raw: unknown) => TOutput;
}

export const CapabilityExecutionSchema = z.object({
  executionId: z.string(),
  capabilityName: CapabilityNameSchema,
  chain: z.string(),
  params: z.record(z.string(), z.unknown()),
  estimatedCost: z.number().int().nonnegative(),
  actualCost: z.number().int().nonnegative().optional(),
  cached: z.boolean().default(false),
  executedAt: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(['SUCCESS', 'FAILED', 'CACHED', 'SKIPPED_BUDGET']),
  error: z.string().optional(),
});

export type CapabilityExecution = z.infer<typeof CapabilityExecutionSchema>;
