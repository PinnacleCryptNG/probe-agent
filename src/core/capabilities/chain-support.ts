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
export const CAPABILITY_CHAIN_SUPPORT: Record<CapabilityName, readonly string[] | 'ALL'> = {
  // General token search & resolution works across all chains
  token_search: 'ALL',

  // Token analytics capabilities supported on EVM and Solana (all chains except Bitcoin)
  token_information: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  flow_intelligence: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  who_bought_sold: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  token_transfers: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  dex_trades: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  historical_flows: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),
  token_holders: ALL_SUPPORTED_CHAINS.filter((c) => c !== 'bitcoin'),

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
