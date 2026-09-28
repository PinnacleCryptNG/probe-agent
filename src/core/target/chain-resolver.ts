import { PROBE_CONSTANTS } from '../../config/constants.js';

interface ChainDefinition {
  canonical: string;
  displayName: string;
  aliases: string[];
}

const CHAIN_DEFINITIONS: ChainDefinition[] = [
  { canonical: 'ethereum', displayName: 'Ethereum', aliases: ['mainnet', 'ethereum mainnet', 'l1'] },
  { canonical: 'solana', displayName: 'Solana', aliases: ['solana network', 'solana chain'] },
  { canonical: 'base', displayName: 'Base', aliases: ['coinbase base', 'base network', 'base chain'] },
  { canonical: 'arbitrum', displayName: 'Arbitrum', aliases: ['arbitrum one', 'arbitrum nitro'] },
  { canonical: 'polygon', displayName: 'Polygon', aliases: ['polygon pos'] },
  { canonical: 'optimism', displayName: 'Optimism', aliases: ['optimistic ethereum', 'optimism mainnet'] },
  { canonical: 'avalanche', displayName: 'Avalanche', aliases: ['avalanche c-chain', 'c-chain'] },
  { canonical: 'bnb', displayName: 'BNB', aliases: ['binance', 'binance smart chain', 'bnb chain', 'bsc'] },
  { canonical: 'fantom', displayName: 'Fantom', aliases: ['fantom opera'] },
  { canonical: 'blast', displayName: 'Blast', aliases: [] },
  { canonical: 'linea', displayName: 'Linea', aliases: [] },
  { canonical: 'mantle', displayName: 'Mantle', aliases: [] },
  { canonical: 'scroll', displayName: 'Scroll', aliases: [] },
  { canonical: 'zksync', displayName: 'zkSync', aliases: ['era', 'zksync era'] },
  { canonical: 'starknet', displayName: 'Starknet', aliases: [] },
  { canonical: 'aptos', displayName: 'Aptos', aliases: ['aptos network'] },
  { canonical: 'sui', displayName: 'Sui', aliases: ['sui network'] },
  { canonical: 'near', displayName: 'NEAR', aliases: ['near protocol'] },
  { canonical: 'tron', displayName: 'Tron', aliases: ['tron network'] },
  { canonical: 'bitcoin', displayName: 'Bitcoin', aliases: ['bitcoin network'] },
  { canonical: 'hyperliquid', displayName: 'Hyperliquid', aliases: ['hyperliquid network', 'hl'] },
  { canonical: 'injective', displayName: 'Injective', aliases: [] },
  { canonical: 'mantra', displayName: 'Mantra', aliases: [] },
  { canonical: 'stacks', displayName: 'Stacks', aliases: [] },
  { canonical: 'stellar', displayName: 'Stellar', aliases: [] },
  { canonical: 'ton', displayName: 'TON', aliases: ['the open network'] },
  { canonical: 'algorand', displayName: 'Algorand', aliases: [] },
  { canonical: 'sei', displayName: 'Sei', aliases: [] },
  { canonical: 'sonic', displayName: 'Sonic', aliases: [] },
  { canonical: 'monad', displayName: 'Monad', aliases: [] },
  { canonical: 'metis', displayName: 'Metis', aliases: [] },
  { canonical: 'chiliz', displayName: 'Chiliz', aliases: [] },
];

const ALIAS_MAP = new Map<string, ChainDefinition>();
const DISPLAY_NAME_MAP = new Map<string, string>();

for (const def of CHAIN_DEFINITIONS) {
  ALIAS_MAP.set(def.canonical.toLowerCase(), def);
  ALIAS_MAP.set(def.displayName.toLowerCase(), def);
  DISPLAY_NAME_MAP.set(def.canonical.toLowerCase(), def.displayName);
  for (const alias of def.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), def);
  }
}

// Ensure all constants chains are indexed
for (const chain of [...PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS, ...PROBE_CONSTANTS.SUPPORTED_NON_EVM_CHAINS]) {
  const lower = chain.toLowerCase();
  if (!ALIAS_MAP.has(lower)) {
    const displayName = chain.charAt(0).toUpperCase() + chain.slice(1);
    const def: ChainDefinition = { canonical: lower, displayName, aliases: [] };
    ALIAS_MAP.set(lower, def);
    DISPLAY_NAME_MAP.set(lower, displayName);
  }
}

/**
 * Normalizes any chain alias or name to canonical lowercase identifier.
 */
export function normalizeChain(input?: string): string | undefined {
  if (!input) return undefined;
  const cleaned = input.trim().toLowerCase().replace(/^(chain|network):\s*/, '').replace(/^(on|in)\s+/, '').trim();
  return ALIAS_MAP.get(cleaned)?.canonical;
}

/**
 * Returns user-facing display name for a canonical chain.
 */
export function getChainDisplayName(chain: string): string {
  const norm = normalizeChain(chain);
  if (!norm) return chain.charAt(0).toUpperCase() + chain.slice(1);
  return DISPLAY_NAME_MAP.get(norm) ?? (chain.charAt(0).toUpperCase() + chain.slice(1));
}

/**
 * Returns the list of display names for standard clarification EVM chains.
 * Authoritative registry: PROBE_CONSTANTS.CLARIFICATION_EVM_CHAINS.
 */
export function getClarificationEvmChainNames(): string[] {
  return PROBE_CONSTANTS.CLARIFICATION_EVM_CHAINS.map(getChainDisplayName);
}

/**
 * Checks whether a given string is a recognized chain name or alias.
 */
export function isCanonicalChain(chainOrAlias?: string): boolean {
  if (!chainOrAlias) return false;
  const cleaned = chainOrAlias.trim().toLowerCase().replace(/^(chain|network):\s*/, '').replace(/^(on|in)\s+/, '').trim();
  return ALIAS_MAP.has(cleaned);
}

/**
 * Extracts an explicit chain context from natural language text.
 * E.g.: "BTC on Ethereum", "SOL on Solana", "PEPE (Arbitrum)", "activity for ETH on Base", "What about Solana?"
 */
export function extractExplicitChain(text: string): { chain: string; displayName: string; rawMatch: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Patterns for explicit chain:
  // 1. "on <chain>" / "network: <chain>" / "chain: <chain>" / "in <chain>"
  const onMatches = Array.from(trimmed.matchAll(/\b(?:on|network:?|chain:?|in)\s+([a-zA-Z0-9_\s-]+?)(?:\s+(?:chain|network))?(?:[?.!,;]|$|\b)/gi));
  for (const m of onMatches) {
    const rawCandidate = m[1]?.trim();
    if (rawCandidate) {
      const firstWord = rawCandidate.split(/\s+/)[0];
      const norm = normalizeChain(rawCandidate) || normalizeChain(firstWord);
      if (norm) {
        return {
          chain: norm,
          displayName: getChainDisplayName(norm),
          rawMatch: m[0],
        };
      }
    }
  }

  // 2. "about <chain>" (e.g. "What about Solana?", "How about Base?")
  // Only matches when candidate is a chain name (e.g. Solana, Base, Ethereum), NOT a ticker like BTC or $SOL.
  const aboutMatches = Array.from(trimmed.matchAll(/\b(?:about)\s+([a-zA-Z0-9_\s-]+?)(?:[?.!,;]|$|\b)/gi));
  for (const m of aboutMatches) {
    const rawCandidate = m[1]?.trim();
    if (rawCandidate) {
      const firstWord = rawCandidate.split(/\s+/)[0];
      const norm = normalizeChain(rawCandidate) || normalizeChain(firstWord);
      // Ensure candidate is an actual chain name, not a token ticker
      const isTickerLike = /^[A-Z]{2,6}$/.test(rawCandidate.toUpperCase()) && !['SOLANA', 'ETHEREUM', 'ARBITRUM', 'POLYGON', 'OPTIMISM', 'AVALANCHE', 'HYPERLIQUID', 'APTOS', 'BASE'].includes(rawCandidate.toUpperCase());
      if (norm && !isTickerLike) {
        return {
          chain: norm,
          displayName: getChainDisplayName(norm),
          rawMatch: m[0],
        };
      }
    }
  }

  // 3. Parenthetical chain "(Ethereum)", "(on Solana)"
  const parenMatches = Array.from(trimmed.matchAll(/\((?:on\s+)?([a-zA-Z0-9_\s-]+?)\)/gi));
  for (const m of parenMatches) {
    const rawCandidate = m[1]?.trim();
    if (rawCandidate) {
      const norm = normalizeChain(rawCandidate);
      if (norm) {
        return {
          chain: norm,
          displayName: getChainDisplayName(norm),
          rawMatch: m[0],
        };
      }
    }
  }

  // 4. "<chain> wallet" / "this <chain> wallet" / "<chain> address" (e.g. "Investigate this Ethereum wallet 0x...")
  const walletMatches = Array.from(trimmed.matchAll(/\b(?:this\s+|the\s+)?([a-zA-Z0-9_-]+)\s+(?:wallet|address)\b/gi));
  for (const m of walletMatches) {
    const rawCandidate = m[1]?.trim();
    if (rawCandidate) {
      const norm = normalizeChain(rawCandidate);
      if (norm) {
        return {
          chain: norm,
          displayName: getChainDisplayName(norm),
          rawMatch: m[0],
        };
      }
    }
  }

  return undefined;
}

/**
 * Detects whether the input is a chain-level scope query without a specific token.
 * E.g.: "What's happening on Solana?", "What's happening on Base?", "Activity on Arbitrum", "solana"
 */
export function detectChainScopeQuery(text: string): { chain: string; displayName: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // 1. Standalone chain input: "solana", "on solana", "network: base"
  const standaloneNorm = normalizeChain(trimmed);
  if (standaloneNorm) {
    return {
      chain: standaloneNorm,
      displayName: getChainDisplayName(standaloneNorm),
    };
  }

  // 2. Questions asking what's happening on a chain:
  // e.g. "What's happening on Solana?", "Why is volume high on Base?", "What changed on Arbitrum?"
  const explicit = extractExplicitChain(trimmed);
  if (explicit) {
    return {
      chain: explicit.chain,
      displayName: explicit.displayName,
    };
  }

  return undefined;
}

