export type {
  InvestigationTarget,
  TokenTarget,
  ChainTarget,
  WalletTarget,
  InvestigationTargetType,
} from '../../types/domain.js';

export {
  InvestigationTargetSchema,
  TokenTargetSchema,
  ChainTargetSchema,
  WalletTargetSchema,
} from '../../types/domain.js';

import { InvestigationTarget } from '../../types/domain.js';

export type TargetResolutionStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS'
  | 'NEEDS_TARGET'
  | 'INVALID_ADDRESS'
  | 'UNRESOLVED';

export type TargetResolutionSource =
  | 'explicit_message'
  | 'explicit_message_with_chain'
  | 'existing_context'
  | 'none';

export interface ResolvedTargetResult {
  status: 'RESOLVED';
  target: InvestigationTarget;
  source: TargetResolutionSource;
  availableChains?: string[];
  candidateIdentifier?: string;
  clarificationMessage?: string;
}

export interface UnresolvedTargetResult {
  status: 'AMBIGUOUS' | 'NEEDS_TARGET' | 'INVALID_ADDRESS' | 'UNRESOLVED';
  target?: undefined;
  source: TargetResolutionSource;
  availableChains?: string[];
  candidateIdentifier?: string;
  clarificationMessage?: string;
}

export type TargetResolutionResult = ResolvedTargetResult | UnresolvedTargetResult;

export interface TargetResolverOptions {
  question: string;
  existingTarget?: InvestigationTarget;
  chatId?: number | string;
  defaultChain?: string;
}

export interface ITargetResolver {
  resolve(options: TargetResolverOptions): Promise<TargetResolutionResult>;
}
