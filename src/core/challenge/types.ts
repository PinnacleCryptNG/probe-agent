import { TokenContext } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { Finding, Hypothesis } from '../../types/domain.js';

export type ChallengeCategory =
  | 'EVIDENCE_CHALLENGE'
  | 'ALTERNATIVE_EXPLANATION'
  | 'CONTRADICTION'
  | 'CERTAINTY'
  | 'FALSIFICATION';

export type ChallengeVerdict =
  | 'supported'
  | 'partially_supported'
  | 'not_supported'
  | 'insufficient_evidence';

export type ChallengeEvidenceStatus =
  | 'SUPPORTED'
  | 'CONTRADICTED'
  | 'INSUFFICIENT';

export type ChallengeInterpretationStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED'
  | 'NOT_APPLICABLE';

export interface FalsificationDiscrimination {
  explanation: string;
  criteria: string[];
}

export interface ChallengeDetectionResult {
  isChallenge: boolean;
  category?: ChallengeCategory;
  specificHypothesis?: string;
}

export interface ChallengeEvidencePoint {
  statement: string;
  evidenceRefs: string[];
}

export interface ChallengeResult {
  verdict: ChallengeVerdict;
  evidenceStatus: ChallengeEvidenceStatus;
  interpretationStatus: ChallengeInterpretationStatus;
  originalFinding: string;
  supportingEvidence: ChallengeEvidencePoint[];
  contradictingEvidence: ChallengeEvidencePoint[];
  alternativeExplanations: ChallengeEvidencePoint[];
  whatIsNotProven: string[];
  whatWouldChangeConclusion: string[];
  conclusion: string;

  // Phase 5B quality hardening fields
  proposedAlternative?: string;
  whatEvidenceEstablishes?: string[];
  discriminatingCriteria?: FalsificationDiscrimination[];
}

export interface ChallengeSynthesisRequest {
  investigationId: string;
  question: string;
  tokenContext: TokenContext;
  evidence: EvidenceItem[];
  originalFinding?: string;
  findings?: Finding[];
  hypotheses?: Hypothesis[];
  unknowns?: string[];
  category?: ChallengeCategory;
  specificHypothesis?: string;
}
