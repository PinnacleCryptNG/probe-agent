import { IResolutionStrategy, StrategyResult } from './types.js';
import { TokenCandidate } from '../types.js';
import { INansenClient } from '../../nansen/client.js';
import { TokenContext } from '../../../types/domain.js';
import { isExactAddressMatch } from '../address-utils.js';
import { logger } from '../../../utils/logger.js';

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

      // Collect unique chains for matching tokens
      const chainSet = new Set<string>();
      for (const m of symbolMatches) {
        if (m.chain) {
          chainSet.add((m.chain as string).toLowerCase());
        }
      }
      const uniqueChains = Array.from(chainSet);

      // Single match or all on single chain
      if (uniqueChains.length <= 1) {
        const topMatch = this.rankTokens(symbolMatches)[0];
        return {
          matched: true,
          status: 'RESOLVED',
          token: this.toTokenContext(topMatch, candidate),
          exactMatch: true,
          rawResultsCount: tokens.length,
          creditCost: 0,
        };
      }

      // Special-case native gas tokens that are unambiguous (ETH on Ethereum, SOL on Solana)
      if (targetSymbol === 'ETH') {
        const ethOnMainnet = symbolMatches.find((t) => (t.chain as string)?.toLowerCase() === 'ethereum');
        if (ethOnMainnet) {
          return {
            matched: true,
            status: 'RESOLVED',
            token: this.toTokenContext(ethOnMainnet, candidate),
            exactMatch: true,
            rawResultsCount: tokens.length,
            creditCost: 0,
          };
        }
      }

      if (targetSymbol === 'SOL') {
        const solOnSolana = symbolMatches.find((t) => (t.chain as string)?.toLowerCase() === 'solana');
        if (solOnSolana) {
          return {
            matched: true,
            status: 'RESOLVED',
            token: this.toTokenContext(solOnSolana, candidate),
            exactMatch: true,
            rawResultsCount: tokens.length,
            creditCost: 0,
          };
        }
      }

      // Multiple competing chains -> AMBIGUOUS_SYMBOL
      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const availableChains = uniqueChains.slice(0, 4).map(capitalize);

      return {
        matched: false,
        status: 'AMBIGUOUS',
        availableChains,
        rawResultsCount: tokens.length,
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

  private rankTokens(tokens: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const primaryChains = ['ethereum', 'solana', 'base'];
    return [...tokens].sort((a, b) => {
      const aPrimary = primaryChains.indexOf(((a.chain as string) ?? '').toLowerCase()) !== -1 ? 1 : 0;
      const bPrimary = primaryChains.indexOf(((b.chain as string) ?? '').toLowerCase()) !== -1 ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      const aVol = (a.volume_24h as number) ?? (a.market_cap as number) ?? 0;
      const bVol = (b.volume_24h as number) ?? (b.market_cap as number) ?? 0;
      return bVol - aVol;
    });
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
