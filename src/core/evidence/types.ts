import { CapabilityName } from '../../types/capabilities.js';
import { EvidenceItem, EvidenceProvenance } from '../../types/evidence.js';

export interface ExecutionContext {
  investigationId: string;
  turnKey?: string;
  tokenAddress?: string;
  chain?: string;
  walletAddress?: string;
  userId?: string;
}

export interface ExecutionResult {
  success: boolean;
  capability: CapabilityName;
  cacheHit: boolean;
  evidence: EvidenceItem[];
  actualCreditCost: number;
  durationMs: number;
  errors: string[];
  provenance?: EvidenceProvenance;
}
