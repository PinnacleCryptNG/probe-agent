import { IResolutionStrategy, StrategyResult } from './types.js';
import { TokenCandidate } from '../types.js';
import { INansenClient } from '../../nansen/client.js';
import { TokenContext } from '../../../types/domain.js';
import { isExactAddressMatch } from '../address-utils.js';
import { logger } from '../../../utils/logger.js';

export class TokenInformationStrategy implements IResolutionStrategy {
  public readonly name = 'TokenInformation';
  public readonly creditCost = 1;

  public canHandle(candidate: TokenCandidate): boolean {
    return candidate.type === 'address' && !!candidate.detectedChain;
  }

  public async resolve(candidate: TokenCandidate, client: INansenClient): Promise<StrategyResult> {
    const chain = candidate.detectedChain ?? 'ethereum';

    try {
      const response = await client.getTokenInformation({
        token_address: candidate.identifier,
        chain,
        timeframe: '1d',
      });

      const cost = response.meta?.creditsCost ?? 1;
      const data = response.data;

      const returnedAddr =
        data.token_address ??
        data.data?.contract_address ??
        '';

      const symbol = data.symbol ?? data.data?.symbol ?? '';
      const name = data.name ?? data.data?.name ?? '';
      const decimals = data.decimals ?? (data.data?.decimals as number | undefined);

      // Verify that this is a valid indexed token (has an actual symbol or name) and address matches
      if (
        returnedAddr &&
        isExactAddressMatch(returnedAddr, candidate.identifier, chain) &&
        (symbol.trim().length > 0 || name.trim().length > 0)
      ) {
        const tokenContext: TokenContext = {
          address: returnedAddr,
          symbol: symbol || 'TOKEN',
          name: name || symbol || candidate.identifier,
          chain: data.chain ?? chain,
          decimals,
          resolvedAt: new Date().toISOString(),
        };

        return {
          matched: true,
          status: 'RESOLVED',
          token: tokenContext,
          exactMatch: true,
          creditCost: cost,
        };
      }

      return {
        matched: false,
        status: 'NO_MATCH',
        exactMatch: false,
        failureReason: 'TOKEN_INFORMATION_NOT_INDEXED',
        creditCost: cost,
      };
    } catch (err) {
      logger.info('TokenInformationStrategy did not resolve token', {
        identifier: candidate.identifier,
        chain,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        matched: false,
        status: 'NO_MATCH',
        failureReason: 'TOKEN_INFORMATION_NOT_FOUND',
        creditCost: 1,
      };
    }
  }
}
