import { INansenClient } from '../nansen/client.js';
import {
  TokenCandidate,
  ITokenResolver,
  TokenResolutionResult,
} from './types.js';
export type { ITokenResolver, TokenResolutionResult, TokenResolutionStatus } from './types.js';
import { TokenContext } from '../../types/domain.js';
import { detectTokenCandidate, extractTokenCandidate } from './detector.js';
import { classifyTokenInput } from './address-utils.js';
import { logger } from '../../utils/logger.js';
import { MemoryCache } from '../cache/memory-cache.js';
import { IResolutionStrategy } from './strategies/types.js';
import { SearchGeneralStrategy } from './strategies/search-general-strategy.js';
import { TokenInformationStrategy } from './strategies/token-information-strategy.js';
import { getNativeAssetForTicker } from '../target/native-assets.js';

export interface TokenResolverDependencies {
  nansenClient?: INansenClient;
  cache?: MemoryCache;
  strategies?: IResolutionStrategy[];
}

export class TokenResolver implements ITokenResolver {
  private readonly nansenClient?: INansenClient;
  private readonly cache?: MemoryCache;
  private readonly strategies: IResolutionStrategy[];
  private readonly localCache = new Map<string, TokenContext>();
  private readonly localNegativeCache = new Map<string, number>();

  constructor(deps?: TokenResolverDependencies) {
    this.nansenClient = deps?.nansenClient;
    this.cache = deps?.cache;
    this.strategies = deps?.strategies ?? [
      new SearchGeneralStrategy(),
      new TokenInformationStrategy(),
    ];
  }

  public async resolve(candidateOrQuery: TokenCandidate | string): Promise<TokenContext | null> {
    const detailed = await this.resolveDetailed(candidateOrQuery);
    return detailed.status === 'RESOLVED' && detailed.token ? detailed.token : null;
  }

  public async resolveDetailed(candidateOrQuery: TokenCandidate | string): Promise<TokenResolutionResult> {
    let candidate: TokenCandidate | undefined;

    if (typeof candidateOrQuery === 'string') {
      const trimmed = candidateOrQuery.trim();
      const classification = classifyTokenInput(trimmed);

      if (classification.type === 'invalid_address') {
        return {
          status: 'INVALID_ADDRESS',
          candidate: {
            identifier: trimmed,
            type: 'invalid_address',
          },
          failureReason: classification.failureReason,
          creditCost: 0,
        };
      }

      candidate = detectTokenCandidate(trimmed) ?? extractTokenCandidate(trimmed);
    } else {
      candidate = candidateOrQuery;
    }

    if (!candidate || candidate.type === 'invalid_address') {
      return {
        status: 'INVALID_ADDRESS',
        candidate,
        failureReason: 'INVALID_OR_MISSING_CANDIDATE',
        creditCost: 0,
      };
    }

    const cacheKey = `resolved_token:${candidate.identifier.toLowerCase()}:${candidate.detectedChain ?? 'any'}`;
    const negativeCacheKey = `unresolved_token:${candidate.identifier.toLowerCase()}:${candidate.detectedChain ?? 'any'}`;

    // 1. Check positive cache
    if (this.localCache.has(cacheKey)) {
      return {
        status: 'RESOLVED',
        token: this.localCache.get(cacheKey)!,
        candidate,
        detectedChain: candidate.detectedChain,
        creditCost: 0,
      };
    }

    if (this.cache) {
      const cached = await this.cache.get<TokenContext>(cacheKey);
      if (cached) {
        return {
          status: 'RESOLVED',
          token: cached,
          candidate,
          detectedChain: candidate.detectedChain,
          creditCost: 0,
        };
      }
    }

    // 2. Check negative cache to avoid draining credits repeatedly on unknown addresses
    const negExpiry = this.localNegativeCache.get(negativeCacheKey);
    if (negExpiry && Date.now() < negExpiry) {
      return {
        status: 'NOT_FOUND',
        candidate,
        detectedChain: candidate.detectedChain,
        failureReason: 'PREVIOUSLY_UNRESOLVED_CACHED',
        creditCost: 0,
      };
    }

    // 3. Live resolution via strategy chain
    if (this.nansenClient) {
      let accumulatedCredits = 0;

      for (const strategy of this.strategies) {
        if (!strategy.canHandle(candidate)) {
          continue;
        }

        try {
          const result = await strategy.resolve(candidate, this.nansenClient);
          accumulatedCredits += result.creditCost;

          if (result.status === 'RESOLVED' && result.token) {
            this.localCache.set(cacheKey, result.token);
            if (this.cache) {
              await this.cache.set(cacheKey, result.token, 3600);
            }

            logger.info('Token resolved via strategy', {
              strategy: strategy.name,
              identifier: candidate.identifier,
              resolvedSymbol: result.token.symbol,
              resolvedChain: result.token.chain,
              creditCost: accumulatedCredits,
            });

            return {
              status: 'RESOLVED',
              token: result.token,
              candidate,
              detectedChain: result.token.chain,
              candidates: result.candidates,
              creditCost: accumulatedCredits,
            };
          }

          if (result.status === 'AMBIGUOUS') {
            return {
              status: 'AMBIGUOUS_SYMBOL',
              candidate,
              availableChains: result.availableChains,
              candidates: result.candidates,
              ambiguityReason: result.ambiguityReason,
              failureReason: 'MULTIPLE_CHAINS_FOR_SYMBOL',
              creditCost: accumulatedCredits,
            };
          }
        } catch (strategyErr) {
          logger.error('Token resolution strategy threw error', {
            strategy: strategy.name,
            identifier: candidate.identifier,
            error: strategyErr instanceof Error ? strategyErr.message : String(strategyErr),
          });
        }
      }

      // If we exhausted all strategies without a match, cache negative result (5 minutes)
      this.localNegativeCache.set(negativeCacheKey, Date.now() + 300_000);

      logger.info('Token could not be resolved by any strategy', {
        identifier: candidate.identifier,
        type: candidate.type,
        detectedChain: candidate.detectedChain,
        creditCost: accumulatedCredits,
      });

      return {
        status: 'NOT_FOUND',
        candidate,
        detectedChain: candidate.detectedChain,
        failureReason: 'NOT_INDEXED_BY_NANSEN',
        creditCost: accumulatedCredits,
      };
    }

    // 4. Offline / unit test fallback when Nansen client is not injected
    return this.resolveOfflineFallback(candidate);
  }

  private resolveOfflineFallback(candidate: TokenCandidate): TokenResolutionResult {
    if (candidate.type === 'invalid_address') {
      return {
        status: 'INVALID_ADDRESS',
        candidate,
        failureReason: 'INVALID_ADDRESS_FORMAT',
        creditCost: 0,
      };
    }

    if (candidate.type === 'address') {
      // Reject malformed EVM addresses in fallback
      if (candidate.identifier.startsWith('0x') && candidate.identifier.length !== 42) {
        return {
          status: 'INVALID_ADDRESS',
          candidate,
          failureReason: 'MALFORMED_EVM_ADDRESS',
          creditCost: 0,
        };
      }

      const addrLower = candidate.identifier.toLowerCase();
      const KNOWN_TOKENS: Record<string, { symbol: string; name: string; chain: string }> = {
        '0x6982508145454ce325ddbe47a25d4ec3d2311933': { symbol: 'PEPE', name: 'Pepe', chain: 'ethereum' },
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', name: 'Wrapped Ether', chain: 'ethereum' },
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', name: 'Wrapped Bitcoin', chain: 'ethereum' },
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', name: 'USD Coin', chain: 'ethereum' },
        '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', name: 'Tether USD', chain: 'ethereum' },
        '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', name: 'Dai Stablecoin', chain: 'ethereum' },
      };

      const known = KNOWN_TOKENS[addrLower];
      if (known) {
        const token: TokenContext = {
          address: addrLower,
          symbol: known.symbol,
          name: known.name,
          chain: candidate.detectedChain || known.chain,
          resolvedAt: new Date().toISOString(),
        };
        return {
          status: 'RESOLVED',
          token,
          candidate,
          detectedChain: token.chain,
          creditCost: 0,
        };
      }

      return {
        status: 'NOT_FOUND',
        candidate,
        failureReason: 'TOKEN_NOT_FOUND',
        creditCost: 0,
      };
    }

    const upper = candidate.identifier.toUpperCase();

    if (upper === 'WETH') {
      return {
        status: 'RESOLVED',
        token: {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          symbol: 'WETH',
          name: 'Wrapped Ether',
          chain: 'ethereum',
          resolvedAt: new Date().toISOString(),
        },
        candidate,
        detectedChain: 'ethereum',
        creditCost: 0,
      };
    }

    if (upper === 'WBTC') {
      return {
        status: 'RESOLVED',
        token: {
          address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          symbol: 'WBTC',
          name: 'Wrapped BTC',
          chain: candidate.detectedChain || 'ethereum',
          resolvedAt: new Date().toISOString(),
        },
        candidate,
        detectedChain: candidate.detectedChain || 'ethereum',
        creditCost: 0,
      };
    }

    const native = getNativeAssetForTicker(upper);
    if (native) {
      const resolvedChain = candidate.detectedChain || native.chain;
      return {
        status: 'RESOLVED',
        token: {
          address: native.address,
          symbol: native.ticker,
          name: native.name,
          chain: resolvedChain,
          resolvedAt: new Date().toISOString(),
        },
        candidate,
        detectedChain: resolvedChain,
        creditCost: 0,
      };
    }

    return {
      status: 'RESOLVED',
      token: {
        address: candidate.identifier.toLowerCase(),
        symbol: upper,
        name: upper,
        chain: candidate.detectedChain || 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
      candidate,
      detectedChain: candidate.detectedChain || 'ethereum',
      creditCost: 0,
    };
  }
}

export const defaultTokenResolver = new TokenResolver();
