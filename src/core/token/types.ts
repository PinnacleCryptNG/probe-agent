import { TokenContext } from '../../types/domain.js';

export type TokenIdentifierType = 'address' | 'symbol' | 'invalid_address';

export interface TokenCandidate {
  identifier: string;
  type: TokenIdentifierType;
  detectedChain?: string;
}

export type TokenResolutionStatus =
  | 'RESOLVED'
  | 'INVALID_ADDRESS'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_SYMBOL';

export interface TokenResolutionResult {
  status: TokenResolutionStatus;
  token?: TokenContext;
  candidate?: TokenCandidate;
  detectedChain?: string;
  availableChains?: string[];
  failureReason?: string;
  creditCost: number;
}

export interface ITokenResolver {
  resolve(candidateOrQuery: TokenCandidate | string): Promise<TokenContext | null>;
  resolveDetailed(candidateOrQuery: TokenCandidate | string): Promise<TokenResolutionResult>;
}
