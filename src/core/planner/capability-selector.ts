import { CapabilityRegistry } from '../capabilities/registry.js';
import { CapabilityName } from '../../types/capabilities.js';
import { getNativeAssetForChain } from '../target/native-assets.js';
import {
  PlanCapability,
  PlanEvidenceRequirement,
  PlannerContext,
  PlanningWarning,
} from './types.js';

export interface SelectorResult {
  selectedCapabilities: CapabilityName[];
  plannedCapabilities: PlanCapability[];
  resolvedRequirements: PlanEvidenceRequirement[];
  unresolvedRequirements: string[];
  warnings: PlanningWarning[];
  estimatedCreditCost: number;
}

export class CapabilitySelector {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Evaluates raw evidence requirements against the CapabilityRegistry.
   * Enforces chain compatibility, input sufficiency, cost prioritization,
   * and deduplication without inventing capabilities.
   */
  public select(
    requirements: PlanEvidenceRequirement[],
    context: PlannerContext
  ): SelectorResult {
    const chain = (context.target?.chain || context.token?.chain || 'ethereum').trim().toLowerCase();
    const tokenAddress = context.token?.address ?? (context.target?.type === 'token' ? context.target.token.address : undefined);
    const warnings: PlanningWarning[] = [];
    const unresolvedRequirements: string[] = [];
    const resolvedRequirements: PlanEvidenceRequirement[] = [];

    // Track selected unique capabilities in order of priority
    const selectedCapSet = new Set<CapabilityName>();
    const plannedCapabilities: PlanCapability[] = [];

    for (const req of requirements) {
      if (req.priority === 'unresolved') {
        unresolvedRequirements.push(req.concept);
        resolvedRequirements.push(req);
        continue;
      }

      // Filter and evaluate candidates against CapabilityRegistry
      const viableCandidates: Array<{ name: CapabilityName; cost: number; params: Record<string, unknown> }> = [];

      for (const capName of req.candidateCapabilities) {
        // 1. Never invent or allow unregistered capabilities
        if (!this.registry.hasCapability(capName)) {
          warnings.push({
            code: 'UNREGISTERED_CAPABILITY',
            message: `Capability '${capName}' is not registered in CapabilityRegistry and was discarded.`,
          });
          continue;
        }

        const capDef = this.registry.getCapability(capName);

        // 2. Verify chain compatibility
        if (!this.registry.isChainSupported(capName, chain)) {
          warnings.push({
            code: 'CHAIN_UNSUPPORTED',
            message: `Capability '${capName}' does not support chain '${chain}'.`,
            impact: `Excluded '${capName}' from plan candidates.`,
          });
          continue;
        }

        // 3. Prepare and verify required inputs
        const params: Record<string, unknown> = {
          ...req.parameters,
          chain,
        };

        if (capDef.requiresToken && !params.token_address) {
          if (tokenAddress) {
            params.token_address = tokenAddress;
          } else if (context.target?.type === 'chain') {
            const native = getNativeAssetForChain(chain);
            if (native) {
              params.token_address = native.address;
            } else {
              warnings.push({
                code: 'CHAIN_UNSUPPORTED',
                message: `Capability '${capName}' requires a native asset for chain '${chain}', but none was found.`,
              });
              continue;
            }
          } else {
            warnings.push({
              code: 'MISSING_TOKEN_INPUT',
              message: `Capability '${capName}' requires token_address which was not provided.`,
            });
            continue;
          }
        }

        if (capDef.requiresAddress && !params.address) {
          const targetAddr =
            context.targetWalletAddress ||
            (context.target?.type === 'wallet' ? context.target.address : undefined) ||
            (req.parameters.address as string | undefined);
          if (targetAddr) {
            params.address = targetAddr;
          } else {
            warnings.push({
              code: 'MISSING_WALLET_INPUT',
              message: `Capability '${capName}' requires a target wallet address which was not provided in context.`,
            });
            continue;
          }
        }

        // 4. Validate inputs against schema
        const validation = this.registry.validateInputs(capName, params);
        if (!validation.success) {
          warnings.push({
            code: 'INVALID_PARAMETERS',
            message: `Parameters for '${capName}' failed validation: ${validation.error}`,
          });
          continue;
        }

        viableCandidates.push({
          name: capName,
          cost: capDef.creditCost,
          params: validation.data as Record<string, unknown>,
        });
      }

      if (viableCandidates.length === 0) {
        if (req.priority === 'required') {
          unresolvedRequirements.push(req.concept);
        }
        resolvedRequirements.push({
          ...req,
          resolvedCapability: undefined,
        });
        continue;
      }

      // 5. Credit-aware selection: prefer lower cost unless requirement specifically dictates holder inspection
      viableCandidates.sort((a, b) => {
        // If holder requirement specifically targets holders, preserve token_holders
        if (req.concept.toLowerCase().includes('holder') && a.name === 'token_holders') return -1;
        if (req.concept.toLowerCase().includes('holder') && b.name === 'token_holders') return 1;
        return a.cost - b.cost;
      });

      const chosen = viableCandidates[0];

      resolvedRequirements.push({
        ...req,
        resolvedCapability: chosen.name,
        parameters: chosen.params,
      });

      // 6. Deduplicate selected capabilities
      if (!selectedCapSet.has(chosen.name)) {
        selectedCapSet.add(chosen.name);
        plannedCapabilities.push({
          name: chosen.name,
          reason: req.rationale,
          estimatedCost: chosen.cost,
          priority: req.priority,
          parameters: chosen.params,
        });
      }
    }

    // 7. Calculate estimated total cost
    let estimatedCreditCost = 0;
    for (const capName of selectedCapSet) {
      estimatedCreditCost += this.registry.getEstimatedCost(capName);
    }

    // 8. Turn budget checks
    const maxCalls = context.maxCallsAllowed ?? 4;
    let selectedCapabilities = Array.from(selectedCapSet);

    if (selectedCapabilities.length > maxCalls) {
      warnings.push({
        code: 'MAX_CALLS_TURN_LIMIT',
        message: `Plan selected ${selectedCapabilities.length} capabilities, which exceeds the max turn limit of ${maxCalls}. Capping to top priority capabilities.`,
      });

      // Keep only top maxCalls capabilities
      selectedCapabilities = selectedCapabilities.slice(0, maxCalls);
      // Recompute cost
      estimatedCreditCost = selectedCapabilities.reduce(
        (sum, cap) => sum + this.registry.getEstimatedCost(cap),
        0
      );
    }

    if (context.remainingCredits !== undefined && estimatedCreditCost > context.remainingCredits) {
      warnings.push({
        code: 'INSUFFICIENT_CREDITS',
        message: `Estimated plan cost of ${estimatedCreditCost} credits exceeds remaining budget of ${context.remainingCredits} credits.`,
      });
    }

    return {
      selectedCapabilities,
      plannedCapabilities,
      resolvedRequirements,
      unresolvedRequirements,
      warnings,
      estimatedCreditCost,
    };
  }
}
