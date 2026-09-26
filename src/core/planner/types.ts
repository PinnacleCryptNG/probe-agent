import { z } from 'zod';
import { CapabilityName } from '../../types/capabilities.js';
import { Finding, InvestigationMessage, TokenContext } from '../../types/domain.js';

export const PlannerIntentSchema = z.enum([
  'token_activity',
  'activity_change',
  'holder_analysis',
  'accumulation',
  'distribution',
  'transfers',
  'large_transactions',
  'trading_activity',
  'dex_activity',
  'wallet_activity',
  'historical_comparison',
  'flow_analysis',
  'wallet_relationships',
  'unknown',
]);

export type PlannerIntent = z.infer<typeof PlannerIntentSchema>;

export type RequirementPriority = 'required' | 'optional' | 'unresolved';

export interface PlanEvidenceRequirement {
  id: string;
  concept: string;
  priority: RequirementPriority;
  rationale: string;
  candidateCapabilities: CapabilityName[];
  resolvedCapability?: CapabilityName;
  parameters: Record<string, unknown>;
}

export interface PlanCapability {
  name: CapabilityName;
  reason: string;
  estimatedCost: number;
  priority: RequirementPriority;
  parameters: Record<string, unknown>;
}

export interface PlanningWarning {
  code: string;
  message: string;
  impact?: string;
}

export interface InvestigationPlan {
  planId: string;
  question: string;
  intent: PlannerIntent;
  tokenContext?: TokenContext;
  evidenceRequirements: PlanEvidenceRequirement[];
  selectedCapabilities: CapabilityName[];
  plannedCapabilities: PlanCapability[];
  estimatedCreditCost: number;
  unresolvedRequirements: string[];
  warnings: PlanningWarning[];
  createdAt: string;
}

export interface PlannerContext {
  token: TokenContext;
  conversationHistory?: InvestigationMessage[];
  activeFindings?: Finding[];
  remainingCredits?: number;
  maxCallsAllowed?: number;
  isChallenge?: boolean;
  targetFindingId?: string;
  targetWalletAddress?: string;
}
