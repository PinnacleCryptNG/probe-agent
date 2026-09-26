/**
 * Core system constants and operational boundaries for PROBE.
 */

export const PROBE_CONSTANTS = {
  // Attribution requirement from Nansen Data Redistribution Guidelines
  NANSEN_ATTRIBUTION_TEXT: 'Powered by Nansen API',
  NANSEN_ATTRIBUTION_FOOTER: '🔍 Blockchain analytics powered by [Nansen](https://nansen.ai/)',

  // Centralized Credit Safety
  DEFAULT_TOTAL_BUDGET: 1100,
  DEFAULT_MAX_CALLS_PER_TURN: 4,

  // Cache configuration
  DEFAULT_CACHE_TTL_SECONDS: 300, // 5 minutes

  // Telegram limits
  TELEGRAM_MAX_MESSAGE_LENGTH: 4096,

  // Chain configurations
  PRIMARY_CHAINS: ['ethereum', 'base', 'solana'] as const,
  SUPPORTED_EVM_CHAINS: [
    'arbitrum', 'arc', 'avalanche', 'base', 'bitlayer', 'bnb', 'chiliz', 'citrea',
    'ethereum', 'gravity', 'hyperevm', 'iotaevm', 'katana', 'linea', 'mantle',
    'metis', 'monad', 'optimism', 'plasma', 'polygon', 'robinhood', 'sei', 'sonic', 'viction'
  ] as const,
  SUPPORTED_NON_EVM_CHAINS: [
    'algorand', 'aptos', 'bitcoin', 'hyperliquid', 'injective', 'mantra', 'near',
    'solana', 'stacks', 'starknet', 'stellar', 'sui', 'ton', 'tron'
  ] as const,

  // Endpoint costs table
  CAPABILITY_COSTS: {
    TOKEN_SEARCH: 0,
    TOKEN_INFORMATION: 1,
    FLOW_INTELLIGENCE: 1,
    WHO_BOUGHT_SOLD: 1,
    TOKEN_TRANSFERS: 1,
    DEX_TRADES: 1,
    HISTORICAL_FLOWS: 1,
    TOKEN_HOLDERS_STANDARD: 5,
    WALLET_CURRENT_BALANCE: 1,
    WALLET_TRANSACTIONS: 1,
    WALLET_RELATED: 1,
    WALLET_FIRST_FUNDER: 1,
    WALLET_COUNTERPARTIES: 5,
    TRANSACTION_DEEP_DIVE: 1,
  } as const,
} as const;

export type PrimaryChain = typeof PROBE_CONSTANTS.PRIMARY_CHAINS[number];
export type SupportedChain =
  | typeof PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS[number]
  | typeof PROBE_CONSTANTS.SUPPORTED_NON_EVM_CHAINS[number];
