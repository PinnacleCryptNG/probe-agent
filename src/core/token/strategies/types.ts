import { TokenCandidate } from '../types.js';
import { TokenContext } from '../../../types/domain.js';
import { INansenClient } from '../../nansen/client.js';

export interface StrategyResult {
  matched: boolean;
  status: 'RESOLVED' | 'NO_MATCH' | 'AMBIGUOUS' | 'ERROR';
  token?: TokenContext;
  exactMatch?: boolean;
  rawResultsCount?: number;
  availableChains?: string[];
  candidates?: Array<Record<string, unknown>>;
  ambiguityReason?: string;
  failureReason?: string;
  creditCost: number;
}

export interface IResolutionStrategy {
  readonly name: string;
  readonly creditCost: number;
  canHandle(candidate: TokenCandidate): boolean;
  resolve(candidate: TokenCandidate, client: INansenClient): Promise<StrategyResult>;
}
