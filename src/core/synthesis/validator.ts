import { EvidenceItem } from '../../types/evidence.js';
import {
  SynthesisResult,
  SynthesisValidationError,
  SynthesisValidationResult,
} from './types.js';

const CAUSAL_PATTERNS = [
  /\bcaused by\b/i,
  /\bproves why\b/i,
  /\bpumped because\b/i,
  /\bpumping because\b/i,
  /\bdumped because\b/i,
  /\bdumping because\b/i,
  /\bdue to news\b/i,
  /\bdue to twitter\b/i,
  /\bdue to announcement\b/i,
  /\bthe reason for the pump\b/i,
  /\bthe reason for the dump\b/i,
];

export class EvidenceValidator {
  /**
   * Validates a candidate SynthesisResult against supplied evidence items and investigation boundaries.
   * Guarantees that the LLM cannot manufacture evidence IDs, invent ungrounded facts,
   * hallucinate addresses/hashes, or make unsupported causal assertions.
   */
  public validate(
    result: SynthesisResult,
    suppliedEvidence: EvidenceItem[],
    investigationId: string,
    targetTokenAddress?: string
  ): SynthesisValidationResult {
    const errors: SynthesisValidationError[] = [];
    const warnings: string[] = [];

    // 1. Validate that all supplied evidence belongs to the current investigation
    for (const item of suppliedEvidence) {
      if (item.investigationId !== investigationId) {
        errors.push({
          code: 'CROSS_INVESTIGATION_EVIDENCE',
          message: `Evidence item '${item.evidenceId}' belongs to investigation '${item.investigationId}', not current investigation '${investigationId}'.`,
          invalidEvidenceRef: item.evidenceId,
        });
      }
    }

    // 2. Build index of valid evidence IDs
    const validEvidenceIds = new Set(suppliedEvidence.map((e) => e.evidenceId));

    // 3. Extract all known addresses and transaction hashes from supplied evidence
    const { knownAddresses, knownHashes } = this.extractKnownEntities(suppliedEvidence, targetTokenAddress);

    // 4. Verify empty evidence handling: factual claims are prohibited if evidence is empty
    if (suppliedEvidence.length === 0) {
      if (result.observations.length > 0 || result.interpretations.length > 0) {
        errors.push({
          code: 'EMPTY_EVIDENCE_FOR_FACTUAL_CLAIMS',
          message: `Synthesis produced factual claims (${result.observations.length} observations, ${result.interpretations.length} interpretations) but 0 evidence items were supplied.`,
        });
      }
    }

    // 5. Validate observations
    for (const obs of result.observations) {
      // Must cite at least one evidence item
      if (!obs.evidenceRefs || obs.evidenceRefs.length === 0) {
        errors.push({
          code: 'FACTUAL_CLAIM_WITHOUT_EVIDENCE',
          message: `Observation '${obs.id}' makes a factual claim without citing any evidence references.`,
          claimId: obs.id,
        });
      } else {
        // Every cited evidenceRef must exist in supplied evidence
        for (const ref of obs.evidenceRefs) {
          if (!validEvidenceIds.has(ref)) {
            errors.push({
              code: 'UNKNOWN_EVIDENCE_REFERENCE',
              message: `Observation '${obs.id}' cites unknown evidence ID '${ref}'.`,
              claimId: obs.id,
              invalidEvidenceRef: ref,
            });
          }
        }
      }

      // Check for ungrounded causal claims in observations
      for (const pat of CAUSAL_PATTERNS) {
        if (pat.test(obs.statement)) {
          errors.push({
            code: 'UNSUPPORTED_CAUSAL_CLAIM',
            message: `Observation '${obs.id}' makes an ungrounded causal claim: "${obs.statement}". Causal claims cannot be stated as direct observations.`,
            claimId: obs.id,
          });
          break;
        }
      }

      // Check for hallucinated transaction hashes
      this.checkEntityHallucinations(obs.id, obs.statement, knownAddresses, knownHashes, errors);
    }

    // 6. Validate interpretations
    for (const interp of result.interpretations) {
      if (!interp.evidenceRefs || interp.evidenceRefs.length === 0) {
        errors.push({
          code: 'INTERPRETATION_WITHOUT_EVIDENCE',
          message: `Interpretation '${interp.id}' does not cite supporting evidence references.`,
          claimId: interp.id,
        });
      } else {
        for (const ref of interp.evidenceRefs) {
          if (!validEvidenceIds.has(ref)) {
            errors.push({
              code: 'UNKNOWN_EVIDENCE_REFERENCE',
              message: `Interpretation '${interp.id}' cites unknown evidence ID '${ref}'.`,
              claimId: interp.id,
              invalidEvidenceRef: ref,
            });
          }
        }
      }

      this.checkEntityHallucinations(interp.id, interp.statement, knownAddresses, knownHashes, errors);
    }

    // 7. Validate hypotheses
    for (const hyp of result.hypotheses) {
      if (hyp.evidenceRefs && hyp.evidenceRefs.length > 0) {
        for (const ref of hyp.evidenceRefs) {
          if (!validEvidenceIds.has(ref)) {
            errors.push({
              code: 'UNKNOWN_EVIDENCE_REFERENCE',
              message: `Hypothesis '${hyp.id}' cites unknown evidence ID '${ref}'.`,
              claimId: hyp.id,
              invalidEvidenceRef: ref,
            });
          }
        }
      }
      this.checkEntityHallucinations(hyp.id, hyp.statement, knownAddresses, knownHashes, errors);
    }

    // 8. Validate unknowns (Unknowns do not require evidence references)
    for (const unk of result.unknowns) {
      if (!unk.statement || unk.statement.trim().length === 0) {
        warnings.push('Unknown item has an empty statement.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Scans a statement for transaction hashes (0x + 64 hex chars) and Ethereum addresses (0x + 40 hex chars)
   * and verifies they exist within the verified evidence set.
   */
  private checkEntityHallucinations(
    claimId: string,
    statement: string,
    knownAddresses: Set<string>,
    knownHashes: Set<string>,
    errors: SynthesisValidationError[]
  ): void {
    // 64 hex chars = 32 bytes (standard transaction hash / topic)
    const hashMatches = statement.match(/\b0x[a-fA-F0-9]{64}\b/g) || [];
    for (const hash of hashMatches) {
      if (!knownHashes.has(hash.toLowerCase())) {
        errors.push({
          code: 'HALLUCINATED_TRANSACTION_HASH',
          message: `Claim '${claimId}' references transaction hash '${hash}' which does not exist anywhere in the supplied evidence.`,
          claimId,
          hallucinatedEntity: hash,
        });
      }
    }

    // 40 hex chars = 20 bytes (standard EVM address)
    const addrMatches = statement.match(/\b0x[a-fA-F0-9]{40}\b/g) || [];
    for (const addr of addrMatches) {
      if (!knownAddresses.has(addr.toLowerCase())) {
        errors.push({
          code: 'HALLUCINATED_WALLET_ADDRESS',
          message: `Claim '${claimId}' references wallet address '${addr}' which does not exist anywhere in the supplied evidence or context.`,
          claimId,
          hallucinatedEntity: addr,
        });
      }
    }
  }

  /**
   * Deeply extracts all known addresses and hashes from evidence records.
   */
  private extractKnownEntities(
    evidence: EvidenceItem[],
    targetTokenAddress?: string
  ): { knownAddresses: Set<string>; knownHashes: Set<string> } {
    const knownAddresses = new Set<string>();
    const knownHashes = new Set<string>();

    if (targetTokenAddress) {
      knownAddresses.add(targetTokenAddress.toLowerCase());
    }

    for (const item of evidence) {
      if (item.provenance.tokenAddress) {
        knownAddresses.add(item.provenance.tokenAddress.toLowerCase());
      }
      if (item.provenance.relevantWallet) {
        knownAddresses.add(item.provenance.relevantWallet.toLowerCase());
      }
      if (item.provenance.transactionHash) {
        knownHashes.add(item.provenance.transactionHash.toLowerCase());
      }

      this.extractFromObject(item.normalizedData, knownAddresses, knownHashes);
      this.extractFromObject(item.provenance.queryParams, knownAddresses, knownHashes);
    }

    return { knownAddresses, knownHashes };
  }

  private extractFromObject(obj: unknown, knownAddresses: Set<string>, knownHashes: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const el of obj) {
        this.extractFromObject(el, knownAddresses, knownHashes);
      }
      return;
    }

    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (typeof val === 'string') {
        const str = val.trim();
        if (/^0x[a-fA-F0-9]{64}$/.test(str)) {
          knownHashes.add(str.toLowerCase());
        } else if (/^0x[a-fA-F0-9]{40}$/.test(str)) {
          knownAddresses.add(str.toLowerCase());
        }
      } else if (typeof val === 'object' && val !== null) {
        this.extractFromObject(val, knownAddresses, knownHashes);
      }
    }
  }
}

export const evidenceValidator = new EvidenceValidator();
