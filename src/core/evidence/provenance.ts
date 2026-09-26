import { EvidenceProvenance } from '../../types/evidence.js';

export interface BuildProvenanceParams {
  endpoint: string;
  capability: string;
  chain: string;
  tokenAddress: string;
  queryParams: Record<string, unknown>;
  retrievedAt?: string;
  creditsCost?: number;
  relevantWallet?: string;
  transactionHash?: string;
  timeRange?: {
    from?: string;
    to?: string;
  };
}

/**
 * Constructs an immutable, validated EvidenceProvenance record.
 * Guarantees that every piece of evidence can be traced back to its
 * underlying Nansen API call, parameters, chain, and timestamp.
 */
export function buildProvenance(params: BuildProvenanceParams): EvidenceProvenance {
  return {
    source: 'nansen',
    endpoint: params.endpoint,
    capability: params.capability,
    chain: params.chain,
    tokenAddress: params.tokenAddress,
    queryParams: params.queryParams,
    retrievedAt: params.retrievedAt ?? new Date().toISOString(),
    creditsCost: params.creditsCost !== undefined ? Math.max(0, Math.floor(params.creditsCost)) : 0,
    relevantWallet: params.relevantWallet,
    transactionHash: params.transactionHash,
    timeRange: params.timeRange,
  };
}
