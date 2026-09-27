import { TokenCandidate } from './types.js';
import { TokenContext } from '../../types/domain.js';
import { getChainDisplayName, normalizeChain } from '../target/chain-resolver.js';
import { isNativeAssetTicker } from '../target/native-assets.js';

const EXCLUDED_WORDS = new Set([
  'IS', 'IT', 'AT', 'ON', 'IN', 'TO', 'SO', 'NO', 'MY', 'UP', 'DO', 'IF', 'ME', 'WE', 'US', 'OR', 'BY', 'AN', 'AS', 'HE',
  'WHY', 'WHO', 'WHAT', 'HOW', 'ARE', 'THE', 'AND', 'FOR', 'NOT', 'CAN',
  'HAS', 'DID', 'NOW', 'NEW', 'TOP', 'ALL', 'OUT', 'GET', 'DAY', 'WAS',
  'YOU', 'HER', 'HIM', 'HIS', 'OUR', 'SEE', 'ANY', 'BUY', 'DEX', 'USD',
  'SHOW', 'FIND', 'LAST', 'PAST', 'THIS', 'THAT', 'THEM', 'THEY', 'FROM',
  'OVER', 'SOME', 'MORE', 'MOST', 'WHEN', 'WITH', 'HAVE', 'BEEN', 'MUCH',
  'WHICH', 'WHERE', 'THERE', 'THEIR', 'ABOUT', 'THESE', 'THOSE', 'PLEASE',
  'TOKEN', 'COIN', 'CHAIN', 'NETWORK', 'CONTRACT', 'ADDRESS',
]);

const COMMON_TICKERS = new Set([
  'ETH', 'SOL', 'BTC', 'WBTC', 'USDC', 'USDT', 'DAI', 'UNI', 'PEPE', 'LINK',
  'AAVE', 'ARB', 'OP', 'MATIC', 'SHIB', 'DOGE', 'AVAX', 'BNB', 'SUI', 'APT',
  'NEAR', 'FTM', 'TON', 'TRX', 'MKR', 'CRV', 'LDO', 'PENDLE', 'RENDER', 'FET',
  'BONK', 'WIF', 'JUP', 'RAY', 'POPCAT', 'BOME', 'MEW',
]);

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/i;
const EVM_ADDRESS_IN_TEXT_REGEX = /0x[a-fA-F0-9]{40}\b/i;

// Solana base58 public keys / token mints are 32-44 base58 characters
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_ADDRESS_IN_TEXT_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/**
 * Checks if the user sent ONLY a blockchain/network name instead of a token.
 * E.g. "solana", "ethereum", "on solana", "base".
 */
export function detectChainOnlyInput(text: string): string | undefined {
  const norm = normalizeChain(text);
  if (norm) {
    return getChainDisplayName(norm);
  }
  return undefined;
}

/**
 * Returns true if the string matches a Solana base58 address format.
 */
export function isSolanaAddress(text: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(text.trim());
}

/**
 * Returns true if the string matches an EVM 0x address format.
 */
export function isEvmAddress(text: string): boolean {
  return EVM_ADDRESS_REGEX.test(text.trim());
}

/**
 * Deterministically detects address or token format from an isolated identifier.
 */
export function detectTokenCandidate(identifier: string): TokenCandidate | undefined {
  const trimmed = identifier.trim();
  if (!trimmed) return undefined;

  // 1. EVM Address (0x...)
  if (isEvmAddress(trimmed)) {
    return {
      identifier: trimmed.toLowerCase(),
      type: 'address',
      detectedChain: 'ethereum',
    };
  }

  // 2. Solana Base58 Address
  if (isSolanaAddress(trimmed)) {
    return {
      identifier: trimmed,
      type: 'address',
      detectedChain: 'solana',
    };
  }

  // 3. Malformed EVM Address (starts with 0x but invalid length or hex)
  if (trimmed.startsWith('0x')) {
    return {
      identifier: trimmed,
      type: 'invalid_address',
      detectedChain: 'ethereum',
    };
  }

  // 4. Malformed Solana Base58 Address (32-44 characters without spaces, but invalid Base58 chars)
  if (trimmed.length >= 32 && trimmed.length <= 44 && !trimmed.includes(' ')) {
    return {
      identifier: trimmed,
      type: 'invalid_address',
      detectedChain: 'solana',
    };
  }

  // 5. Cashtag symbol ($PEPE)
  const cashtagMatch = trimmed.match(/^\$([A-Za-z0-9]{1,15})$/);
  if (cashtagMatch) {
    return {
      identifier: cashtagMatch[1].toUpperCase(),
      type: 'symbol',
    };
  }

  // 6. Clean ticker/symbol
  const upper = trimmed.toUpperCase();
  if (
    /^[A-Za-z0-9]{1,15}$/.test(trimmed) &&
    !EXCLUDED_WORDS.has(upper) &&
    !detectChainOnlyInput(trimmed) &&
    !/^\d+$/.test(trimmed)
  ) {
    return {
      identifier: upper,
      type: 'symbol',
    };
  }

  return undefined;
}

/**
 * Extracts a candidate token identifier (address or symbol) from user input or natural-language query.
 * Does NOT decide validity; only parses candidate strings.
 */
export function extractTokenCandidate(text: string): TokenCandidate | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // If user passed a single standalone token/address
  const directCandidate = detectTokenCandidate(trimmed);
  if (directCandidate) {
    return directCandidate;
  }

  // 1. Check for EVM address inside text
  const evmMatch = trimmed.match(EVM_ADDRESS_IN_TEXT_REGEX);
  if (evmMatch) {
    return {
      identifier: evmMatch[0].toLowerCase(),
      type: 'address',
      detectedChain: 'ethereum',
    };
  }

  // 2. Check for Solana address inside text
  const solMatch = trimmed.match(SOLANA_ADDRESS_IN_TEXT_REGEX);
  if (solMatch) {
    return {
      identifier: solMatch[0],
      type: 'address',
      detectedChain: 'solana',
    };
  }

  // 3. Check for cashtag prefix (e.g. $PEPE, $ETH, $UNI)
  const cashtagMatch = trimmed.match(/\$([A-Za-z0-9]{1,15})\b/);
  if (cashtagMatch) {
    return {
      identifier: cashtagMatch[1].toUpperCase(),
      type: 'symbol',
    };
  }

  // 4. Check for ticker embedded within natural language (e.g. "Why is ETH activity changing?")
  const words = trimmed.split(/[\s,?.!;:()]+/);
  for (const word of words) {
    const upper = word.toUpperCase();
    if (
      word.length >= 2 &&
      word.length <= 10 &&
      /^[A-Za-z0-9]+$/.test(word) &&
      !EXCLUDED_WORDS.has(upper) &&
      !detectChainOnlyInput(word) &&
      !/^\d+$/.test(word) &&
      (word === upper || COMMON_TICKERS.has(upper) || isNativeAssetTicker(upper))
    ) {
      return {
        identifier: upper,
        type: 'symbol',
      };
    }
  }

  return undefined;
}

/**
 * Backwards-compatible synchronous helper returning a tentative TokenContext
 * before asynchronous Nansen resolution completes.
 */
export function extractTokenFromText(text: string): TokenContext | undefined {
  const candidate = extractTokenCandidate(text);
  if (!candidate) return undefined;

  if (candidate.type === 'address') {
    return {
      address: candidate.identifier,
      symbol: 'TOKEN',
      name: `Token ${candidate.identifier.slice(0, 8)}...`,
      chain: candidate.detectedChain || 'ethereum',
      resolvedAt: new Date().toISOString(),
    };
  }

  const sym = candidate.identifier.toUpperCase();
  if (sym === 'ETH') {
    return {
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'ETH',
      name: 'Ethereum',
      chain: 'ethereum',
      resolvedAt: new Date().toISOString(),
    };
  }
  if (sym === 'WETH') {
    return {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      chain: 'ethereum',
      resolvedAt: new Date().toISOString(),
    };
  }
  if (sym === 'SOL') {
    return {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      chain: 'solana',
      resolvedAt: new Date().toISOString(),
    };
  }
  if (sym === 'BTC' || sym === 'WBTC') {
    return {
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      symbol: sym,
      name: sym === 'WBTC' ? 'Wrapped BTC' : 'Bitcoin',
      chain: candidate.detectedChain || 'ethereum',
      resolvedAt: new Date().toISOString(),
    };
  }

  return {
    address: candidate.identifier.toLowerCase(),
    symbol: sym,
    name: sym,
    chain: candidate.detectedChain || 'ethereum',
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Determines whether user input was intended strictly as a token entry (rather than an investigation question).
 */
export function isOnlyTokenInput(text: string, candidate?: TokenCandidate | TokenContext): boolean {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);

  if (candidate) {
    if (words.length === 1) return true;
    const symbol = 'symbol' in candidate ? candidate.symbol : candidate.identifier;
    const address = 'address' in candidate ? candidate.address : candidate.identifier;
    if (trimmed.toLowerCase() === symbol.toLowerCase()) return true;
    if (trimmed.toLowerCase() === '$' + symbol.toLowerCase()) return true;
    if (trimmed.toLowerCase() === address.toLowerCase()) return true;
    return false;
  }

  // Single word entry
  if (words.length === 1) {
    const lower = trimmed.toLowerCase();
    const isQuestionWord = [
      'why', 'who', 'what', 'how', 'when', 'where', 'help', 'is', 'are', 'check',
      'show', 'find', 'explain', 'predict', 'analyze'
    ].includes(lower);
    if (!isQuestionWord && !detectChainOnlyInput(trimmed)) {
      return true;
    }
  }

  // Address format entries
  if (isEvmAddress(trimmed) || isSolanaAddress(trimmed)) {
    return true;
  }

  return false;
}
