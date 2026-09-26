import { config as dotenvConfig } from 'dotenv';
import { isSolanaAddress, isEvmAddress, detectTokenCandidate, extractTokenCandidate } from '../src/core/token/detector.js';
import { NansenClient } from '../src/core/nansen/client.js';
import { isExactAddressMatch } from '../src/core/token/address-utils.js';

// Silence logging so ONLY the diagnostic output is printed
process.env.LOG_LEVEL = 'error';
dotenvConfig();

interface DiagnosticOutput {
  input: string;
  detectedFormat: string;
  detectedChain: string;
  nansenSearchStatus: string;
  nansenResultCount: number | string;
  exactAddressMatch: string;
  resolvedToken: string;
  resolvedChain: string;
  failureReason: string;
  creditCost: number;
}

export async function runDiagnostic(input: string): Promise<DiagnosticOutput> {
  const trimmed = input.trim();
  let detectedFormat = 'UNKNOWN';
  let detectedChain = 'NONE';
  let failureReason = 'NONE';
  let creditCost = 0;

  // 1. Candidate Detection & Format Classification
  if (isEvmAddress(trimmed)) {
    detectedFormat = 'EVM_HEX';
    detectedChain = 'ethereum';
  } else if (isSolanaAddress(trimmed)) {
    detectedFormat = 'SOLANA_BASE58';
    detectedChain = 'solana';
  } else if (trimmed.startsWith('0x')) {
    detectedFormat = 'INVALID_EVM_ADDRESS';
    failureReason = 'INVALID_ADDRESS_FORMAT';
  } else if (trimmed.length >= 32 && trimmed.length <= 44 && !trimmed.includes(' ')) {
    detectedFormat = 'INVALID_BASE58_ADDRESS';
    failureReason = 'INVALID_ADDRESS_FORMAT';
  } else {
    const candidate = detectTokenCandidate(trimmed) ?? extractTokenCandidate(trimmed);
    if (candidate?.type === 'symbol') {
      detectedFormat = 'SYMBOL';
      detectedChain = candidate.detectedChain ?? 'NONE';
    } else {
      detectedFormat = 'UNKNOWN';
      failureReason = 'UNRECOGNIZED_INPUT_FORMAT';
    }
  }

  // If format is invalid, return immediately
  if (failureReason === 'INVALID_ADDRESS_FORMAT' || detectedFormat === 'UNKNOWN') {
    return {
      input: trimmed,
      detectedFormat,
      detectedChain,
      nansenSearchStatus: 'NOT_CALLED',
      nansenResultCount: 0,
      exactAddressMatch: 'NO',
      resolvedToken: 'NONE',
      resolvedChain: 'NONE',
      failureReason,
      creditCost: 0,
    };
  }

  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey || apiKey === 'dummy_nansen_key_for_testing') {
    return {
      input: trimmed,
      detectedFormat,
      detectedChain,
      nansenSearchStatus: 'NO_API_KEY',
      nansenResultCount: 0,
      exactAddressMatch: 'NO',
      resolvedToken: 'NONE',
      resolvedChain: 'NONE',
      failureReason: 'NANSEN_API_KEY_NOT_CONFIGURED',
      creditCost: 0,
    };
  }

  const client = new NansenClient({ apiKey });

  let nansenSearchStatus = 'UNKNOWN';
  let nansenResultCount: number | string = 0;
  let exactAddressMatch = 'NO';
  let resolvedToken = 'NONE';
  let resolvedChain = 'NONE';

  // Strategy 1: SearchGeneral (0 credits)
  try {
    const searchParams: { search_query: string; chain?: string } = {
      search_query: trimmed,
    };
    if (detectedChain !== 'NONE') {
      searchParams.chain = detectedChain;
    }

    const searchResponse = await client.searchGeneral(searchParams);
    nansenSearchStatus = 'HTTP_200';
    creditCost += searchResponse.meta.creditsCost; // 0 credits

    const raw = (searchResponse.data ?? {}) as Record<string, unknown>;
    const rawData = (raw.data ?? {}) as Record<string, unknown>;
    const tokens =
      ((raw.tokens ?? raw.results ?? rawData.tokens ?? rawData.results ?? []) as Array<Record<string, unknown>>);

    nansenResultCount = tokens.length;

    if (detectedFormat === 'SOLANA_BASE58' || detectedFormat === 'EVM_HEX') {
      const match = tokens.find((t) => {
        const itemAddr = (t.address as string) ?? (t.contract_address as string) ?? '';
        return isExactAddressMatch(itemAddr, trimmed, detectedChain);
      });

      if (match) {
        exactAddressMatch = 'YES';
        resolvedToken = (match.symbol as string) || (match.name as string) || 'UNKNOWN';
        resolvedChain = (match.chain as string) || detectedChain;
        return {
          input: trimmed,
          detectedFormat,
          detectedChain,
          nansenSearchStatus,
          nansenResultCount,
          exactAddressMatch,
          resolvedToken,
          resolvedChain,
          failureReason: 'NONE',
          creditCost,
        };
      }
    } else if (detectedFormat === 'SYMBOL') {
      const exactSym = tokens.filter(
        (t) => ((t.symbol as string) ?? '').toUpperCase() === trimmed.toUpperCase()
      );
      if (exactSym.length === 1) {
        resolvedToken = (exactSym[0].symbol as string) || trimmed.toUpperCase();
        resolvedChain = (exactSym[0].chain as string) || 'ethereum';
        return {
          input: trimmed,
          detectedFormat,
          detectedChain,
          nansenSearchStatus,
          nansenResultCount,
          exactAddressMatch: 'N/A',
          resolvedToken,
          resolvedChain,
          failureReason: 'NONE',
          creditCost,
        };
      } else if (exactSym.length > 1) {
        return {
          input: trimmed,
          detectedFormat,
          detectedChain,
          nansenSearchStatus,
          nansenResultCount,
          exactAddressMatch: 'N/A',
          resolvedToken: 'NONE',
          resolvedChain: 'NONE',
          failureReason: 'AMBIGUOUS_SYMBOL',
          creditCost,
        };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    nansenSearchStatus = msg.includes('404') ? 'HTTP_404' : 'FAILED';
  }

  // Strategy 2: TokenInformation fallback for addresses (1 credit)
  if ((detectedFormat === 'SOLANA_BASE58' || detectedFormat === 'EVM_HEX') && detectedChain !== 'NONE') {
    try {
      const tokenInfoResponse = await client.getTokenInformation({
        token_address: trimmed,
        chain: detectedChain,
        timeframe: '1d',
      });

      creditCost += tokenInfoResponse.meta.creditsCost || 1;

      const infoData = tokenInfoResponse.data;
      const returnedAddr =
        infoData.token_address ??
        infoData.data?.contract_address ??
        '';

      const symbol = infoData.symbol ?? infoData.data?.symbol ?? '';
      const name = infoData.name ?? infoData.data?.name ?? '';

      if (
        returnedAddr &&
        isExactAddressMatch(returnedAddr, trimmed, detectedChain) &&
        (symbol.trim().length > 0 || name.trim().length > 0)
      ) {
        exactAddressMatch = 'YES';
        resolvedToken = symbol || name;
        resolvedChain = infoData.chain ?? detectedChain;
        return {
          input: trimmed,
          detectedFormat,
          detectedChain,
          nansenSearchStatus,
          nansenResultCount,
          exactAddressMatch,
          resolvedToken,
          resolvedChain,
          failureReason: 'NONE',
          creditCost,
        };
      }
    } catch {
      // Fallback failed
    }
  }

  // Final unresolved classification
  if (detectedFormat === 'SOLANA_BASE58' || detectedFormat === 'EVM_HEX') {
    failureReason = Number(nansenResultCount) === 0 ? 'NOT_INDEXED_BY_NANSEN' : 'NO_EXACT_ADDRESS_MATCH';
  } else if (detectedFormat === 'SYMBOL') {
    failureReason = 'SYMBOL_NOT_FOUND';
  }

  return {
    input: trimmed,
    detectedFormat,
    detectedChain,
    nansenSearchStatus,
    nansenResultCount,
    exactAddressMatch,
    resolvedToken,
    resolvedChain,
    failureReason,
    creditCost,
  };
}

// CLI Execution entrypoint
if (process.argv[1]?.includes('diagnose-token')) {
  const tokenAddress = process.argv[2];
  if (!tokenAddress) {
    console.error('Usage: tsx scripts/diagnose-token.ts <TOKEN_ADDRESS>');
    process.exit(1);
  }

  // Mute console.log/info from logger while running diagnostic
  const origLog = console.log;
  console.log = () => {};

  runDiagnostic(tokenAddress).then((result) => {
    console.log = origLog;
    console.log(`INPUT: ${result.input}`);
    console.log(`DETECTED FORMAT: ${result.detectedFormat}`);
    console.log(`DETECTED CHAIN: ${result.detectedChain}`);
    console.log(`NANSEN SEARCH STATUS: ${result.nansenSearchStatus}`);
    console.log(`NANSEN RESULT COUNT: ${result.nansenResultCount}`);
    console.log(`EXACT ADDRESS MATCH: ${result.exactAddressMatch}`);
    console.log(`RESOLVED TOKEN: ${result.resolvedToken}`);
    console.log(`RESOLVED CHAIN: ${result.resolvedChain}`);
    console.log(`FAILURE REASON: ${result.failureReason}`);
    console.log(`CREDIT COST: ${result.creditCost}`);
  }).catch((err) => {
    console.log = origLog;
    console.error('Diagnostic error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
