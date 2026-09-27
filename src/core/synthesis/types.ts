import { Finding, InvestigationMessage, TokenContext } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import { InvestigationPlan } from '../planner/types.js';
import {
  ChainTarget,
  InvestigationTarget,
  TokenTarget,
  TransactionTarget,
  WalletTarget,
} from '../target/types.js';

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

export interface TokenInvestigationResult {
  targetType: 'token';
  target: TokenTarget;
  overview: {
    token: string;
    chain: string;
    contract: string;
    marketContext?: string;
  };
  flowActivity: {
    inflowsOutflows?: string;
    buyersSellers?: string;
    smartMoney?: string;
    transfers?: string;
    dexTrades?: string;
  };
  notableActivity: string[];
  findings: SynthesisObservation[];
  evidence: string[];
  limitations: string[];
  confidence: SynthesisConfidence;
  followUps: string[];
}

export interface WalletInvestigationResult {
  targetType: 'wallet';
  target: WalletTarget;
  balances: {
    nativeAsset?: string;
    tokenPositions?: string[];
    portfolioValue?: string;
    rawCount?: number;
  };
  recentActivity: string[];
  largeMovements: string[];
  funding: {
    firstFunder?: string;
    firstFundingActivity?: string;
  };
  counterparties: string[];
  relatedWallets: string[];
  findings: SynthesisObservation[];
  notEstablished: string[];
  evidence: string[];
  limitations: string[];
  confidence: SynthesisConfidence;
  followUps: string[];
}

export interface TransactionInvestigationResult {
  targetType: 'transaction';
  target: TransactionTarget;
  status?: string;
  when?: string;
  from?: string;
  to?: string;
  assetValue?: string;
  transactionType?: string;
  movement?: string;
  counterparties?: string[];
  notableDetails?: string[];
  findings: SynthesisObservation[];
  notEstablished: string[];
  evidence: string[];
  limitations: string[];
  confidence: SynthesisConfidence;
  followUps: string[];
}

export interface ChainInvestigationResult {
  targetType: 'chain';
  target: ChainTarget;
  overview: {
    chain: string;
    nativeAsset?: string;
  };
  currentActivity?: string;
  largeTransactions: string[];
  whaleSmartMoneyActivity: string[];
  nativeAssetActivity?: string;
  notableMovements: string[];
  findings: SynthesisObservation[];
  notEstablished: string[];
  evidence: string[];
  limitations: string[];
  confidence: SynthesisConfidence;
  followUps: string[];
}

export type TypedInvestigationResult =
  | TokenInvestigationResult
  | WalletInvestigationResult
  | TransactionInvestigationResult
  | ChainInvestigationResult;

export interface SynthesisResult {
  success: boolean;
  answer: string;
  headline?: string;
  typedResult?: TypedInvestigationResult;
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
