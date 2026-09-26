import { TokenContext } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { InvestigationPlan } from '../planner/types.js';
import { SynthesisResult } from '../synthesis/types.js';

import { ChallengeResult } from '../challenge/types.js';

export type InvestigationTurnStatus =
  | 'completed'
  | 'needs_clarification'
  | 'insufficient_evidence'
  | 'budget_limited'
  | 'failed';

export interface InvestigationTurnRequest {
  investigationId?: string;
  chatId?: number | string;
  question: string;
  token?: TokenContext;
  userId?: string;
  maxCallsAllowed?: number;
  remainingCredits?: number;
  targetWalletAddress?: string;
}

export interface InvestigationTurnResult {
  investigationId: string;
  turnId: string;
  status: InvestigationTurnStatus;

  question: string;
  token?: TokenContext;

  plan?: InvestigationPlan;

  evidence: EvidenceItem[];

  synthesis?: SynthesisResult;

  challenge?: ChallengeResult;

  clarificationQuestions?: string[];

  unresolvedRequirements?: string[];

  error?: {
    code: string;
    message: string;
  };
}
