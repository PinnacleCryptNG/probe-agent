import { InvestigationTarget, TokenContext } from '../../types/domain.js';
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

export type InvestigationProgressStage =
  | 'token_identified'
  | 'activity_analyzed'
  | 'building_report';

export interface InvestigationTurnRequest {
  investigationId?: string;
  chatId?: number | string;
  question: string;
  token?: TokenContext;
  target?: InvestigationTarget;
  userId?: string;
  maxCallsAllowed?: number;
  remainingCredits?: number;
  targetWalletAddress?: string;
  onProgress?: (stage: InvestigationProgressStage) => void | Promise<void>;
}

export interface InvestigationTurnResult {
  investigationId: string;
  turnId: string;
  status: InvestigationTurnStatus;

  question: string;
  target?: InvestigationTarget;
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
