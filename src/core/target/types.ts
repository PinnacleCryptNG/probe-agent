export type {
  InvestigationTarget,
  TokenTarget,
  ChainTarget,
  WalletTarget,
  TransactionTarget,
  InvestigationTargetType,
} from '../../types/domain.js';

export {
  InvestigationTargetSchema,
  TokenTargetSchema,
  ChainTargetSchema,
  WalletTargetSchema,
  TransactionTargetSchema,
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
  candidateType?: 'token' | 'wallet' | 'transaction' | 'chain';
  clarificationMessage?: string;
}

export type TargetResolutionResult = ResolvedTargetResult | UnresolvedTargetResult;

export type PendingResolutionContext =
  | {
      type: 'token';
      symbol: string;
      selectedChain?: string;
    }
  | {
      type: 'wallet';
      address: string;
      selectedChain?: string;
    }
  | {
      type: 'transaction';
      transactionHash: string;
      selectedChain?: string;
    };

export interface TargetResolverOptions {
  question: string;
  existingTarget?: InvestigationTarget;
  chatId?: number | string;
  defaultChain?: string;
  pendingResolution?: PendingResolutionContext;
}

export interface ITargetResolver {
  resolve(options: TargetResolverOptions): Promise<TargetResolutionResult>;
}
