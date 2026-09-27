import { IResolutionStrategy, StrategyResult } from './types.js';
import { TokenCandidate } from '../types.js';
import { INansenClient } from '../../nansen/client.js';
import { TokenContext } from '../../../types/domain.js';
import { isExactAddressMatch } from '../address-utils.js';
import { logger } from '../../../utils/logger.js';
import { getNativeAssetForTicker } from '../../target/native-assets.js';

export class SearchGeneralStrategy implements IResolutionStrategy {
  public readonly name = 'SearchGeneral';
  public readonly creditCost = 0;

  public canHandle(candidate: TokenCandidate): boolean {
    return candidate.type === 'address' || candidate.type === 'symbol';
  }

  public async resolve(candidate: TokenCandidate, client: INansenClient): Promise<StrategyResult> {
    try {
      // 1. Search with chain filter if available
      const searchParams: { search_query: string; chain?: string } = {
        search_query: candidate.identifier,
      };
      if (candidate.detectedChain) {
        searchParams.chain = candidate.detectedChain;
      }

      let response = await client.searchGeneral(searchParams);
      let tokens = this.extractTokensFromResponse(response.data);

      // If no tokens found with chain filter for an address, try without chain filter
      if (tokens.length === 0 && candidate.detectedChain) {
        response = await client.searchGeneral({
          search_query: candidate.identifier,
        });
        tokens = this.extractTokensFromResponse(response.data);
      }

      if (tokens.length === 0) {
        return {
          matched: false,
          status: 'NO_MATCH',
          exactMatch: false,
          rawResultsCount: 0,
          failureReason: 'NOT_INDEXED_BY_NANSEN',
          creditCost: 0,
        };
      }

      // Address resolution: STRICT exact match only! Never accept fuzzy matches.
      if (candidate.type === 'address') {
        const exact = tokens.find((t) => {
          const itemAddr = (t.address as string) ?? (t.contract_address as string) ?? '';
          return isExactAddressMatch(itemAddr, candidate.identifier, candidate.detectedChain);
        });

        if (exact) {
          const resolvedChain = (exact.chain as string) || candidate.detectedChain || 'ethereum';
          const tokenContext: TokenContext = {
            address: (exact.address as string) ?? candidate.identifier,
            symbol: (exact.symbol as string) || 'TOKEN',
            name: (exact.name as string) || (exact.symbol as string) || candidate.identifier,
            chain: resolvedChain,
            decimals: exact.decimals as number | undefined,
            resolvedAt: new Date().toISOString(),
          };

          return {
            matched: true,
            status: 'RESOLVED',
            token: tokenContext,
            exactMatch: true,
            rawResultsCount: tokens.length,
            creditCost: 0,
          };
        }

        // Fuzzy results returned, but NONE matched the requested address exactly!
        return {
          matched: false,
          status: 'NO_MATCH',
          exactMatch: false,
          rawResultsCount: tokens.length,
          failureReason: 'NO_EXACT_ADDRESS_MATCH',
          creditCost: 0,
        };
      }

      // Symbol resolution
      const targetSymbol = candidate.identifier.toUpperCase();
      const symbolMatches = tokens.filter(
        (t) => ((t.symbol as string) ?? '').toUpperCase() === targetSymbol
      );

      if (symbolMatches.length === 0) {
        return {
          matched: false,
          status: 'NO_MATCH',
          exactMatch: false,
          rawResultsCount: tokens.length,
          failureReason: 'SYMBOL_NOT_FOUND',
          creditCost: 0,
        };
      }

      // Check native asset registry for unambiguous native gas tokens (ETH on Ethereum, SOL on Solana, HYPE on Hyperliquid, APT on Aptos, etc.)
      const nativeAsset = getNativeAssetForTicker(targetSymbol);
      if (nativeAsset) {
        const preferredChain = candidate.detectedChain?.toLowerCase() || nativeAsset.chain;
        const nativeMatch =
          symbolMatches.find((t) => (t.chain as string)?.toLowerCase() === preferredChain) ||
          symbolMatches.find((t) => (t.chain as string)?.toLowerCase() === nativeAsset.chain);
        if (nativeMatch) {
          return {
            matched: true,
            status: 'RESOLVED',
            token: this.toTokenContext(nativeMatch, candidate),
            exactMatch: true,
            rawResultsCount: tokens.length,
            candidates: symbolMatches,
            creditCost: 0,
          };
        }
      }

      // Filter by candidate.detectedChain if explicitly specified
      if (candidate.detectedChain) {
        const chainMatches = symbolMatches.filter(
          (t) => (t.chain as string)?.toLowerCase() === candidate.detectedChain?.toLowerCase()
        );
        if (chainMatches.length > 0) {
          const topMatch = this.rankTokens(chainMatches)[0];
          return {
            matched: true,
            status: 'RESOLVED',
            token: this.toTokenContext(topMatch, candidate),
            exactMatch: true,
            rawResultsCount: tokens.length,
            candidates: symbolMatches,
            creditCost: 0,
          };
        }
      }

      // Collect unique chains for matching tokens
      const chainSet = new Set<string>();
      for (const m of symbolMatches) {
        if (m.chain) {
          chainSet.add((m.chain as string).toLowerCase());
        }
      }
      const uniqueChains = Array.from(chainSet);

      // Single match or all on single chain -> resolve immediately
      if (symbolMatches.length === 1 || uniqueChains.length <= 1) {
        const topMatch = this.rankTokens(symbolMatches)[0];
        return {
          matched: true,
          status: 'RESOLVED',
          token: this.toTokenContext(topMatch, candidate),
          exactMatch: true,
          rawResultsCount: tokens.length,
          candidates: symbolMatches,
          creditCost: 0,
        };
      }

      // Multiple competing candidates across multiple chains.
      // Rank by composite market importance (market cap, volume, rank, verification, primary chains).
      const ranked = this.rankTokens(symbolMatches);
      const topMatch = ranked[0];
      const runnerUp = ranked[1];
      const topScore = this.computeCandidateScore(topMatch);
      const runnerUpScore = runnerUp ? this.computeCandidateScore(runnerUp) : 0;

      // Determine if top candidate is sufficiently dominant/canonical vs genuinely ambiguous.
      // Genuine ambiguity occurs ONLY when multiple candidates on DIFFERENT chains have comparable,
      // substantial market activity (neither candidate has 3x+ score), or all have 0/negligible metrics.
      const isDominant =
        topScore > 0 &&
        (!runnerUp ||
          ((topMatch.chain as string)?.toLowerCase() === (runnerUp.chain as string)?.toLowerCase()) ||
          runnerUpScore === 0 ||
          topScore >= runnerUpScore * 3 ||
          (Boolean(topMatch.verified) && !runnerUp.verified) ||
          (typeof topMatch.rank === 'number' &&
            topMatch.rank > 0 &&
            topMatch.rank <= 500 &&
            (!runnerUp.rank || (runnerUp.rank as number) > 2000)));

      if (isDominant) {
        return {
          matched: true,
          status: 'RESOLVED',
          token: this.toTokenContext(topMatch, candidate),
          exactMatch: true,
          rawResultsCount: tokens.length,
          candidates: symbolMatches,
          creditCost: 0,
        };
      }

      // Multiple competing chains without a dominant candidate -> AMBIGUOUS
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const availableChains = uniqueChains.slice(0, 4).map(capitalize);

      return {
        matched: false,
        status: 'AMBIGUOUS',
        availableChains,
        rawResultsCount: tokens.length,
        candidates: symbolMatches,
        ambiguityReason: `Multiple competing candidates found for ${targetSymbol} across chains without a dominant token`,
        failureReason: 'AMBIGUOUS_SYMBOL',
        creditCost: 0,
      };
    } catch (err) {
      logger.error('SearchGeneralStrategy error', {
        identifier: candidate.identifier,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        matched: false,
        status: 'ERROR',
        failureReason: err instanceof Error ? err.message : 'SEARCH_REQUEST_FAILED',
        creditCost: 0,
      };
    }
  }

  private extractTokensFromResponse(data: unknown): Array<Record<string, unknown>> {
    const raw = (data ?? {}) as Record<string, unknown>;
    const rawData = (raw.data ?? {}) as Record<string, unknown>;
    return (raw.tokens ?? raw.results ?? rawData.tokens ?? rawData.results ?? []) as Array<Record<string, unknown>>;
  }

  private computeCandidateScore(t: Record<string, unknown>): number {
    const mcap = Math.max(
      0,
      Number(t.market_cap ?? t.market_cap_usd ?? t.marketCapUsd ?? t.marketCap ?? 0)
    );
    const vol = Math.max(
      0,
      Number(t.volume_24h ?? t.volume_24h_usd ?? t.volume24hUsd ?? t.volume24h ?? t.volume_usd_24h ?? 0)
    );
    let score = Math.max(mcap, vol * 10);

    const rank = Number(t.rank) || 0;
    if (rank > 0 && rank <= 100) {
      score += 50_000_000;
    } else if (rank > 0 && rank <= 500) {
      score += 20_000_000;
    } else if (rank > 0 && rank <= 2000) {
      score += 5_000_000;
    }

    if (t.verified) {
      score += 10_000_000;
    }

    const chain = ((t.chain as string) ?? '').toLowerCase();
    const primaryChains = ['ethereum', 'solana', 'base', 'hyperliquid', 'arbitrum'];
    if (primaryChains.includes(chain)) {
      score += 2_000_000;
    }

    return score;
  }

  private rankTokens(tokens: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return [...tokens].sort((a, b) => this.computeCandidateScore(b) - this.computeCandidateScore(a));
  }

  private toTokenContext(item: Record<string, unknown>, candidate: TokenCandidate): TokenContext {
    return {
      address: (item.address as string) ?? (item.contract_address as string) ?? candidate.identifier,
      symbol: (item.symbol as string) || candidate.identifier.toUpperCase(),
      name: (item.name as string) || (item.symbol as string) || candidate.identifier,
      chain: (item.chain as string) || candidate.detectedChain || 'ethereum',
      decimals: item.decimals as number | undefined,
      resolvedAt: new Date().toISOString(),
    };
  }
}
