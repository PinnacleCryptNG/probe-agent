import { Finding, InvestigationMessage, TokenContext } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { InvestigationPlan } from '../planner/types.js';
import { InvestigationTarget } from '../target/types.js';

export type SynthesisConfidence = 'high' | 'medium' | 'low';

export interface SynthesisObservation {
  id: string;
  statement: string;
  evidenceRefs: string[];
}

export interface SynthesisInterpretation {
  id: string;
  statement: string;
  confidence: SynthesisConfidence;
  confidenceRationale?: string;
  evidenceRefs: string[];
}

export interface SynthesisHypothesis {
  id: string;
  statement: string;
  evidenceRefs: string[];
}

export interface SynthesisUnknown {
  statement: string;
  reason: string;
}

export interface SynthesisResult {
  success: boolean;
  answer: string;
  headline?: string;
  observations: SynthesisObservation[];
  interpretations: SynthesisInterpretation[];
  hypotheses: SynthesisHypothesis[];
  unknowns: SynthesisUnknown[];
  evidenceRefs: string[];
  evidenceCategories?: string[];
  followUpQuestions: string[];
  validated: boolean;
  validationErrors?: string[];
  investigationId: string;
  createdAt: string;
}

export interface SynthesisRequest {
  question: string;
  investigationId: string;
  tokenContext: TokenContext;
  target?: InvestigationTarget;
  plan?: InvestigationPlan;
  evidence: EvidenceItem[];
  conversationHistory?: InvestigationMessage[];
  activeFindings?: Finding[];
}

export interface SynthesisValidationError {
  code: string;
  message: string;
  claimId?: string;
  invalidEvidenceRef?: string;
  hallucinatedEntity?: string;
}

export interface SynthesisValidationResult {
  isValid: boolean;
  errors: SynthesisValidationError[];
  warnings: string[];
}
