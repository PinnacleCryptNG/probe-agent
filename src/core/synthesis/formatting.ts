/**
 * Utilities for formatting flow metrics, addresses, and follow-up suggestions in synthesis reports.
 */

/**
 * Formats a USD numeric value cleanly into compact financial representation:
 * e.g. +$613.97M, -$25.40M, +$36.57M, $0, -$14.80K, +$900.00K
 */
export function formatFlowUsd(val: number, withSign = true): string {
  if (val === 0) return '$0';
  const abs = Math.abs(val);
  const sign = withSign ? (val > 0 ? '+' : '-') : '';
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Truncates an EVM or Solana address for clean readable presentation (e.g. 0xd8da...6045).
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Derives natural, relevant next question suggestions based on current investigation topic.
 */
export function deriveNextSuggestions(question: string, _symbol: string): string[] {
  const qLower = question.toLowerCase();
  if (/who.*buy|buyer/i.test(qLower)) {
    return ['Who is selling?', 'Biggest transactions', 'Are whales accumulating?'];
  }
  if (/who.*sell|seller/i.test(qLower)) {
    return ['Who is buying?', 'Biggest transactions', 'Are whales accumulating?'];
  }
  if (/whale/i.test(qLower)) {
    return ['Who is buying?', 'Are smart money wallets accumulating?', 'Biggest transactions'];
  }
  if (/smart money/i.test(qLower)) {
    return ['Are whales accumulating?', 'Who is buying?', 'Biggest transactions'];
  }
  if (/big|transfer|transaction/i.test(qLower)) {
    return ['Who is buying?', 'Who is selling?', 'What changed recently?'];
  }
  if (/change|recent|happening/i.test(qLower)) {
    return ['Who is buying?', 'Who is selling?', 'Are whales accumulating?'];
  }
  return ['Who is buying?', 'Biggest transactions', 'Are whales accumulating?'];
}
