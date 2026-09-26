import { isEvmAddress, isSolanaAddress } from './detector.js';

/**
 * Normalizes an on-chain address for comparison:
 * - EVM addresses are case-insensitive hex: lowercase
 * - Solana addresses are base58: case-sensitive (preserved)
 */
export function normalizeAddress(address: string, chain?: string): string {
  const trimmed = address.trim();
  const c = chain?.trim().toLowerCase();
  if (c === 'solana') {
    return trimmed;
  }
  return trimmed.toLowerCase();
}

/**
 * Checks if two addresses match exactly according to their chain conventions.
 */
export function isExactAddressMatch(addressA: string, addressB: string, chain?: string): boolean {
  if (!addressA || !addressB) return false;
  return normalizeAddress(addressA, chain) === normalizeAddress(addressB, chain);
}

export type InputClassification =
  | { type: 'evm_address'; chain: 'ethereum'; identifier: string }
  | { type: 'solana_address'; chain: 'solana'; identifier: string }
  | { type: 'invalid_address'; identifier: string; failureReason: 'INVALID_EVM_FORMAT' | 'INVALID_BASE58_FORMAT' }
  | { type: 'symbol'; identifier: string }
  | { type: 'unknown'; identifier: string };

/**
 * Classifies an isolated input string deterministically without adding regexes.
 */
export function classifyTokenInput(input: string): InputClassification {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'unknown', identifier: trimmed };
  }

  // 1. Valid EVM
  if (isEvmAddress(trimmed)) {
    return { type: 'evm_address', chain: 'ethereum', identifier: trimmed.toLowerCase() };
  }

  // 2. Valid Solana Base58
  if (isSolanaAddress(trimmed)) {
    return { type: 'solana_address', chain: 'solana', identifier: trimmed };
  }

  // 3. Malformed EVM (starts with 0x but invalid length or chars)
  if (trimmed.startsWith('0x')) {
    return {
      type: 'invalid_address',
      identifier: trimmed,
      failureReason: 'INVALID_EVM_FORMAT',
    };
  }

  // 4. Malformed Solana Base58 (length between 32 and 44 characters, but not valid base58)
  if (trimmed.length >= 32 && trimmed.length <= 44) {
    return {
      type: 'invalid_address',
      identifier: trimmed,
      failureReason: 'INVALID_BASE58_FORMAT',
    };
  }

  // 5. Symbol candidate (1-15 characters, alphanumeric)
  const isCashtag = trimmed.startsWith('$');
  const cleanTicker = isCashtag ? trimmed.slice(1) : trimmed;
  if (/^[A-Za-z0-9]{1,15}$/.test(cleanTicker) && !/^\d+$/.test(cleanTicker)) {
    return { type: 'symbol', identifier: cleanTicker.toUpperCase() };
  }

  return { type: 'unknown', identifier: trimmed };
}
