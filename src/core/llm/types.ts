import {
  EvidenceRequirement,
  Finding,
  Hypothesis,
  Intent,
  InvestigationMessage,
  TokenContext,
} from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';

export interface LLMPlanningRequest {
  tokenContext: TokenContext;
  userQuestion: string;
  availableCapabilities: Array<{
    name: string;
    description: string;
    creditCost: number;
    supportedChains: readonly string[] | 'ALL';
  }>;
  conversationHistory: InvestigationMessage[];
  maxCallsAllowed: number;
  remainingCredits: number;
}

export interface LLMPlanningResponse {
  intent: Intent;
  evidenceRequirements: EvidenceRequirement[];
  reasoningSummary: string;
}

export interface LLMSynthesisRequest {
  tokenContext: TokenContext;
  userQuestion: string;
  evidence: EvidenceItem[];
  conversationHistory: InvestigationMessage[];
}

export interface LLMSynthesisResponse {
  answerMarkdown: string;
  headline?: string;
  interpretation?: string;
  evidenceCategories?: string[];
  findings: Finding[];
  hypotheses: Hypothesis[];
  openQuestions: string[];
  usage?: {
    promptTokens?: number;
    candidateTokens?: number;
    thoughtTokens?: number;
    totalTokens?: number;
  };
}

export interface LLMChallengeRequest {
  tokenContext: TokenContext;
  currentFindings: Finding[];
  userChallenge: string;
  availableEvidence: EvidenceItem[];
}

export interface LLMChallengeResponse {
  evaluationMarkdown: string;
  concededPoints: string[];
  counterEvidencePoints: string[];
  updatedFindings: Finding[];
}
