import { PROBE_CONSTANTS } from '../../config/constants.js';
import { CapabilityName } from '../../types/capabilities.js';

export const ALL_SUPPORTED_CHAINS = [
  ...PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
  ...PROBE_CONSTANTS.SUPPORTED_NON_EVM_CHAINS,
] as const;

export type SupportedChain = (typeof ALL_SUPPORTED_CHAINS)[number];

/**
 * Centralized mapping of capability -> supported chains.
 * Explicitly separates capabilities that support Solana/multi-chain from those
 * that are EVM-only or have specific chain omissions (e.g. Profiler transactions on Solana).
 */
// Token God Mode (TGM) endpoints on Nansen only support EVM chains and Solana.
// Non-EVM chains (Aptos, Sui, Near, Ton, Tron, Algorand, Stacks, Stellar, Injective, Mantra, Starknet, Bitcoin)
// do not support TGM endpoints like token_transfers or dex_trades.
export const SUPPORTED_TGM_CHAINS = [
  ...PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
  'solana',
  'hyperliquid',
] as const;

export const CAPABILITY_CHAIN_SUPPORT: Record<CapabilityName, readonly string[] | 'ALL'> = {
  // General token search & resolution works across all chains
  token_search: 'ALL',

  // Token analytics capabilities supported on EVM and Solana only
  token_information: SUPPORTED_TGM_CHAINS,
  flow_intelligence: SUPPORTED_TGM_CHAINS,
  who_bought_sold: SUPPORTED_TGM_CHAINS,
  token_transfers: SUPPORTED_TGM_CHAINS,
  dex_trades: SUPPORTED_TGM_CHAINS,
  historical_flows: SUPPORTED_TGM_CHAINS,
  token_holders: SUPPORTED_TGM_CHAINS,

  // Wallet / Profiler capabilities
  wallet_current_balance: 'ALL',
  // Historical wallet transactions profiler endpoint does not support Solana
  wallet_transactions: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'solana' && c !== 'bitcoin'),
  // Cluster / graph / trace profiler endpoints are EVM-only
  wallet_related: PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
  wallet_first_funder: PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
  wallet_counterparties: 'ALL',
  transaction_deep_dive: PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS,
};

/**
 * Checks whether a given capability is supported on a target blockchain.
 */
export function isCapabilitySupportedOnChain(capability: CapabilityName, chain: string): boolean {
  const normalized = chain.trim().toLowerCase();
  const support = CAPABILITY_CHAIN_SUPPORT[capability];

  if (!support) return false;
  if (support === 'ALL') return true;
  return support.includes(normalized);
}
