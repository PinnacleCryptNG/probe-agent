import { PROBE_CONSTANTS } from '../../config/constants.js';
import { ICache } from '../cache/cache-interface.js';
import { generateCacheKey } from '../cache/key-generator.js';
import { CapabilityRegistry } from '../capabilities/registry.js';
import { CreditBudgetManager } from '../credit/budget-manager.js';
import { INansenClient } from '../nansen/client.js';
import {
  CounterpartiesRequest,
  DexTradesRequest,
  FirstFunderRequest,
  FlowIntelligenceRequest,
  HistoricalFlowsRequest,
  NansenApiResponse,
  RelatedWalletsRequest,
  SearchGeneralRequest,
  TokenHoldersRequest,
  TokenInformationRequest,
  TokenTransfersRequest,
  TransactionLookupRequest,
  WalletBalanceRequest,
  WalletTransactionsRequest,
  WhoBoughtSoldRequest,
} from '../nansen/types.js';
import { CapabilityName } from '../../types/capabilities.js';
import { EvidenceRequirement } from '../../types/domain.js';
import { EvidenceItem } from '../../types/evidence.js';
import {
  UnsupportedCapabilityError,
  UnsupportedChainError,
} from '../../types/errors.js';
import { logger } from '../../utils/logger.js';
import { EvidenceNormalizer, IEvidenceNormalizer } from './normalizer.js';
import { buildProvenance } from './provenance.js';
import { ExecutionContext, ExecutionResult } from './types.js';

export interface EvidenceExecutorDependencies {
  capabilityRegistry: CapabilityRegistry;
  nansenClient: INansenClient;
  creditManager: CreditBudgetManager;
  cache: ICache;
  normalizer?: IEvidenceNormalizer;
  cacheTtlSeconds?: number;
}

/**
 * Resolves the appropriate on-chain token identifier for a given capability.
 * Native gas tokens (such as native ETH: 0xeeee...) are supported directly
 * by cohort flow intelligence, but contract-level trading, swap, and holder
 * capabilities require the canonical ERC-20 wrapped token (e.g. WETH).
 */
export function resolveCapabilityTokenAddress(
  capability: CapabilityName,
  chain: string,
  tokenAddress?: string
): string | undefined {
  if (!tokenAddress) return undefined;
  const lowerAddr = tokenAddress.toLowerCase();
  const lowerChain = chain.toLowerCase();

  const isNativeEth =
    lowerChain === 'ethereum' &&
    (lowerAddr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || lowerAddr === 'native' || lowerAddr === 'eth');

  if (isNativeEth) {
    if (capability === 'flow_intelligence') {
      return '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    }
    return '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  }

  return tokenAddress;
}

export class EvidenceExecutor {
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly nansenClient: INansenClient;
  private readonly creditManager: CreditBudgetManager;
  private readonly cache: ICache;
  private readonly normalizer: IEvidenceNormalizer;
  private readonly cacheTtlSeconds: number;

  constructor(deps: EvidenceExecutorDependencies) {
    this.capabilityRegistry = deps.capabilityRegistry;
    this.nansenClient = deps.nansenClient;
    this.creditManager = deps.creditManager;
    this.cache = deps.cache;
    this.normalizer = deps.normalizer ?? new EvidenceNormalizer();
    this.cacheTtlSeconds = deps.cacheTtlSeconds ?? PROBE_CONSTANTS.DEFAULT_CACHE_TTL_SECONDS;
  }

  /**
   * Executes a single EvidenceRequirement through the verified capability pipeline.
   * Enforces input validation, chain support, deterministic caching, credit budget
   * validation, and safe observational normalization.
   */
  public async execute(
    requirement: EvidenceRequirement,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const capNameRaw = requirement.capabilityName;

    // 1. Determine registered capability
    if (!this.capabilityRegistry.hasCapability(capNameRaw)) {
      const err = new UnsupportedCapabilityError(capNameRaw);
      logger.warn('Execution rejected: unsupported capability', {
        investigationId: context.investigationId,
        capability: capNameRaw,
      });
      return {
        success: false,
        capability: capNameRaw as CapabilityName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: Date.now() - startTime,
        errors: [err.message],
      };
    }

    const capName = capNameRaw as CapabilityName;
    const capDef = this.capabilityRegistry.getCapability(capName);

    // 2. Validate required inputs against registered schema
    const validation = this.capabilityRegistry.validateInputs(capName, requirement.parameters);
    if (!validation.success) {
      const errMsg = `Validation failed for capability '${capName}': ${validation.error}`;
      logger.warn('Execution rejected: invalid capability inputs', {
        investigationId: context.investigationId,
        capability: capName,
        error: errMsg,
      });
      return {
        success: false,
        capability: capName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: Date.now() - startTime,
        errors: [errMsg],
      };
    }

    const validatedParams = validation.data as Record<string, unknown>;

    // 3. Check whether capability supports requested chain
    const chain = ((validatedParams.chain as string) || context.chain || 'ethereum').trim().toLowerCase();
    if (!this.capabilityRegistry.isChainSupported(capName, chain)) {
      const err = new UnsupportedChainError(chain, capName);
      logger.warn('Execution rejected: unsupported chain', {
        investigationId: context.investigationId,
        capability: capName,
        chain,
      });
      return {
        success: false,
        capability: capName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: Date.now() - startTime,
        errors: [err.message],
      };
    }

    // 4. Generate deterministic cache key
    const token = (
      (validatedParams.token_address as string) ||
      context.tokenAddress ||
      (validatedParams.address as string) ||
      (validatedParams.transaction_hash as string) ||
      (validatedParams.query as string) ||
      'global'
    )
      .trim()
      .toLowerCase();

    const cacheKey = generateCacheKey({
      chain,
      token,
      capability: capName,
      queryParams: validatedParams,
    });

    // 5. Check the cache
    try {
      const cached = await this.cache.get<EvidenceItem[]>(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        // 6. Cache Hit: return cached evidence without spending credits
        logger.info('Cache hit for evidence requirement', {
          investigationId: context.investigationId,
          capability: capName,
          cacheKey,
        });

        const remappedEvidence: EvidenceItem[] = cached.map((item) => ({
          ...item,
          investigationId: context.investigationId,
        }));

        return {
          success: true,
          capability: capName,
          cacheHit: true,
          evidence: remappedEvidence,
          actualCreditCost: 0,
          durationMs: Date.now() - startTime,
          errors: [],
          provenance: remappedEvidence[0]?.provenance,
        };
      }
    } catch (cacheErr) {
      logger.warn('Cache lookup failed, proceeding to live execution', {
        error: String(cacheErr),
      });
    }

    // 7. Estimate capability cost from registry
    const estimatedCost = this.capabilityRegistry.getEstimatedCost(capName);

    // 8. Ask credit budget manager for permission
    const turnKey = context.turnKey ?? `${context.investigationId}:turn`;
    try {
      this.creditManager.assertCanSpend(estimatedCost);
      this.creditManager.recordTurnCall(turnKey);
    } catch (budgetErr) {
      const errMsg = budgetErr instanceof Error ? budgetErr.message : String(budgetErr);
      logger.warn('Execution rejected: credit limit or budget exceeded', {
        investigationId: context.investigationId,
        capability: capName,
        error: errMsg,
      });

      return {
        success: false,
        capability: capName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: Date.now() - startTime,
        errors: [errMsg],
      };
    }

    // 9. Execute correct Nansen capability via typed NansenClient method
    let apiResponse: NansenApiResponse<unknown>;
    try {
      apiResponse = await this.dispatchNansenMethod(capName, validatedParams, context.investigationId);
    } catch (apiErr) {
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      logger.error('Nansen API execution failed', {
        investigationId: context.investigationId,
        capability: capName,
        error: errMsg,
      });

      return {
        success: false,
        capability: capName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: Date.now() - startTime,
        errors: [errMsg],
      };
    }

    // 10. Capture actual credit usage from response metadata / headers
    const actualCreditCost = Math.max(0, apiResponse.meta?.creditsCost ?? estimatedCost);
    this.creditManager.recordUsage({
      estimatedCost,
      actualCost: actualCreditCost,
      investigationId: context.investigationId,
      userId: context.userId,
      capability: capName,
      endpoint: capDef.endpoint,
    });

    // 11. Preserve complete provenance
    const provenance = buildProvenance({
      endpoint: capDef.endpoint,
      capability: capName,
      chain,
      tokenAddress: token,
      queryParams: validatedParams,
      creditsCost: actualCreditCost,
      relevantWallet: (validatedParams.address as string | undefined),
      transactionHash: (validatedParams.transaction_hash as string | undefined),
      timeRange: (validatedParams.date as { from?: string; to?: string } | undefined),
    });

    // 12. Normalize response into EvidenceItem objects
    let evidence: EvidenceItem[];
    try {
      evidence = this.normalizer.normalize({
        capability: capName,
        rawData: apiResponse.data,
        provenance,
        investigationId: context.investigationId,
      });
    } catch (normErr) {
      const errMsg = normErr instanceof Error ? normErr.message : String(normErr);
      logger.error('Evidence normalization failed', {
        investigationId: context.investigationId,
        capability: capName,
        error: errMsg,
      });

      return {
        success: false,
        capability: capName,
        cacheHit: false,
        evidence: [],
        actualCreditCost: actualCreditCost,
        durationMs: Date.now() - startTime,
        errors: [errMsg],
        provenance,
      };
    }

    // 13. Store evidence in cache
    try {
      await this.cache.set(cacheKey, evidence, this.cacheTtlSeconds);
    } catch (cacheSetErr) {
      logger.warn('Failed to cache evidence item', {
        cacheKey,
        error: String(cacheSetErr),
      });
    }

    // 14. Return structured execution result
    return {
      success: true,
      capability: capName,
      cacheHit: false,
      evidence,
      actualCreditCost,
      durationMs: Date.now() - startTime,
      errors: [],
      provenance,
    };
  }

  /**
   * Executes multiple EvidenceRequirements sequentially or until budget constraints stop execution.
   */
  public async executeMany(
    requirements: EvidenceRequirement[],
    context: ExecutionContext
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    // Sort by priority if specified (priority 1 is highest)
    const sorted = [...requirements].sort((a, b) => a.priority - b.priority);

    for (const req of sorted) {
      const res = await this.execute(req, context);
      results.push(res);

      // If budget or rate limits were hit, abort further requirements gracefully
      if (
        !res.success &&
        res.errors.some(
          (e) =>
            e.includes('budget') ||
            e.includes('maximum allowed Nansen calls') ||
            e.includes('rate limit')
        )
      ) {
        logger.info('Halting further evidence execution due to budget or rate limit constraint', {
          investigationId: context.investigationId,
          executedCount: results.length,
          remainingCount: requirements.length - results.length,
        });
        break;
      }
    }

    return results;
  }

  /**
   * Maps registered capability name to the corresponding typed NansenClient method.
   * Guarantees that URL, HTTP method, and headers cannot be arbitrary.
   */
  private async dispatchNansenMethod(
    capability: CapabilityName,
    params: Record<string, unknown>,
    investigationId: string
  ): Promise<NansenApiResponse<unknown>> {
    const chain = ((params.chain as string) || 'ethereum').toLowerCase();
    const effectiveToken = resolveCapabilityTokenAddress(capability, chain, params.token_address as string);

    const callParams: Record<string, unknown> = {
      ...params,
      ...(effectiveToken ? { token_address: effectiveToken } : {}),
    };

    switch (capability) {
      case 'token_search': {
        const searchQuery = (callParams.search_query as string) || (callParams.query as string) || '';
        return await this.nansenClient.searchGeneral(
          { ...callParams, search_query: searchQuery, query: searchQuery } as SearchGeneralRequest,
          investigationId
        );
      }

      case 'token_information':
        return await this.nansenClient.getTokenInformation(
          { ...callParams, timeframe: (callParams.timeframe as any) || '1d' } as TokenInformationRequest,
          investigationId
        );

      case 'flow_intelligence':
        return await this.nansenClient.getFlowIntelligence(
          { ...callParams, timeframe: (callParams.timeframe as any) || '1d' } as FlowIntelligenceRequest,
          investigationId
        );

      case 'who_bought_sold':
        return await this.nansenClient.getWhoBoughtSold(callParams as unknown as WhoBoughtSoldRequest, investigationId);

      case 'token_transfers': {
        const { min_value_usd: _min_value_usd, ...restParams } = callParams;
        return await this.nansenClient.getTokenTransfers(restParams as unknown as TokenTransfersRequest, investigationId);
      }

      case 'dex_trades':
        return await this.nansenClient.getDexTrades(callParams as unknown as DexTradesRequest, investigationId);

      case 'historical_flows':
        return await this.nansenClient.getHistoricalFlows(callParams as unknown as HistoricalFlowsRequest, investigationId);

      case 'token_holders':
        return await this.nansenClient.getTokenHolders(callParams as unknown as TokenHoldersRequest, investigationId);

      case 'wallet_current_balance':
        return await this.nansenClient.getWalletBalance(callParams as unknown as WalletBalanceRequest, investigationId);

      case 'wallet_transactions':
        return await this.nansenClient.getWalletTransactions(callParams as unknown as WalletTransactionsRequest, investigationId);

      case 'wallet_related':
        return await this.nansenClient.getRelatedWallets(callParams as unknown as RelatedWalletsRequest, investigationId);

      case 'wallet_first_funder':
        return await this.nansenClient.getFirstFunder(callParams as unknown as FirstFunderRequest, investigationId);

      case 'wallet_counterparties':
        return await this.nansenClient.getCounterparties(callParams as unknown as CounterpartiesRequest, investigationId);

      case 'transaction_deep_dive':
        return await this.nansenClient.lookupTransaction(callParams as unknown as TransactionLookupRequest, investigationId);

      default:
        throw new UnsupportedCapabilityError(capability);
    }
  }
}
