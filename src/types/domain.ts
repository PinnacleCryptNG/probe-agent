import { z } from 'zod';
import {
  EpistemicStatusSchema,
  EvidenceItemSchema,
  EvidenceReferenceSchema
} from './evidence.js';

export const InvestigationStateSchema = z.enum([
  'INITIALIZED',
  'TOKEN_RESOLVED',
  'PLANNING',
  'INVESTIGATING',
  'EVIDENCE_READY',
  'ANSWERED',
  'CHALLENGED',
  'CLOSED',
]);

export type InvestigationState = z.infer<typeof InvestigationStateSchema>;

export const TokenContextSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  chain: z.string(),
  decimals: z.number().optional(),
  priceUsd: z.number().optional(),
  marketCapUsd: z.number().optional(),
  liquidityUsd: z.number().optional(),
  resolvedAt: z.string().datetime(),
});

export type TokenContext = z.infer<typeof TokenContextSchema>;

export type InvestigationTargetType = 'token' | 'chain' | 'wallet';

export const TokenTargetSchema = z.object({
  type: z.literal('token'),
  token: TokenContextSchema,
  chain: z.string(),
  rawIdentifier: z.string().optional(),
  explicitChain: z.string().optional(),
});

export type TokenTarget = z.infer<typeof TokenTargetSchema>;

export const ChainTargetSchema = z.object({
  type: z.literal('chain'),
  chain: z.string(),
  chainDisplayName: z.string(),
  rawIdentifier: z.string().optional(),
});

export type ChainTarget = z.infer<typeof ChainTargetSchema>;

export const WalletTargetSchema = z.object({
  type: z.literal('wallet'),
  address: z.string(),
  chain: z.string(),
  label: z.string().optional(),
  rawIdentifier: z.string().optional(),
});

export type WalletTarget = z.infer<typeof WalletTargetSchema>;

export const InvestigationTargetSchema = z.discriminatedUnion('type', [
  TokenTargetSchema,
  ChainTargetSchema,
  WalletTargetSchema,
]);

export type InvestigationTarget = z.infer<typeof InvestigationTargetSchema>;

export const InvestigationMessageSchema = z.object({
  id: z.string(),
  investigationId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InvestigationMessage = z.infer<typeof InvestigationMessageSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  askedAt: z.string().datetime(),
  userId: z.string(),
});

export type Question = z.infer<typeof QuestionSchema>;

export const IntentCategorySchema = z.enum([
  'ACCUMULATION_INSPECTION',
  'DUMP_OR_OUTFLOW_ANALYSIS',
  'SMART_MONEY_FLOWS',
  'HOLDER_CONCENTRATION',
  'FRESH_WALLET_ACTIVITY',
  'COUNTERPARTY_NETWORK',
  'DEX_VOLUME_ANALYSIS',
  'WALLET_PROFILING',
  'GENERAL_INQUIRY',
]);

export type IntentCategory = z.infer<typeof IntentCategorySchema>;

export const IntentSchema = z.object({
  category: IntentCategorySchema,
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Intent = z.infer<typeof IntentSchema>;

export const EvidenceRequirementSchema = z.object({
  id: z.string(),
  capabilityName: z.string(),
  reason: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  priority: z.number().int().positive(),
  estimatedCost: z.number().int().nonnegative(),
});

export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  claim: z.string(),
  status: EpistemicStatusSchema,
  evidenceReferences: z.array(EvidenceReferenceSchema),
  confidence: z.number().min(0).max(1),
});

export type Finding = z.infer<typeof FindingSchema>;

export const HypothesisSchema = z.object({
  id: z.string(),
  statement: z.string(),
  supportingFindingIds: z.array(z.string()),
  counterFindingIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const ChallengeSchema = z.object({
  id: z.string(),
  questionText: z.string(),
  targetedFindingId: z.string().optional(),
  userCounterpoint: z.string(),
  resolutionStatus: z.enum(['pending', 'addressed', 'refuted']),
  resolvedAt: z.string().datetime().optional(),
});

export type Challenge = z.infer<typeof ChallengeSchema>;

export const TimelineEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  eventType: z.string(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  evidenceReferenceId: z.string().optional(),
});

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const InvestigationSchema = z.object({
  id: z.string(),
  telegramChatId: z.union([z.number(), z.string()]),
  token: TokenContextSchema.optional(),
  target: InvestigationTargetSchema.optional(),
  chain: z.string(),
  initialQuestion: z.string(),
  currentQuestion: z.string(),
  state: InvestigationStateSchema,
  messages: z.array(InvestigationMessageSchema),
  evidence: z.array(EvidenceItemSchema),
  findings: z.array(FindingSchema),
  hypotheses: z.array(HypothesisSchema),
  openQuestions: z.array(z.string()),
  timeline: z.array(TimelineEventSchema),
  totalCreditsUsed: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Investigation = z.infer<typeof InvestigationSchema>;
