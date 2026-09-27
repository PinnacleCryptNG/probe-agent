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

import { InvestigationTarget } from '../target/types.js';
import { isCapabilitySupportedOnChain } from '../capabilities/chain-support.js';
import {
  ChainInvestigationResult,
  TokenInvestigationResult,
  TransactionInvestigationResult,
  TypedInvestigationResult,
  WalletInvestigationResult,
} from './types.js';

/**
 * Derives natural, relevant next question suggestions based on current investigation topic.
 * Tailors suggestions to target type and only shows suggestions for capabilities supported on that chain.
 */
export function deriveNextSuggestions(
  question: string,
  _symbol: string,
  target?: InvestigationTarget
): string[] {
  if (target?.type === 'wallet') {
    const chain = target.chain.toLowerCase();
    const canTxs = isCapabilitySupportedOnChain('wallet_transactions', chain);
    const canFunder = isCapabilitySupportedOnChain('wallet_first_funder', chain);
    const canCounterparties = isCapabilitySupportedOnChain('wallet_counterparties', chain);
    const canRelated = isCapabilitySupportedOnChain('wallet_related', chain);

    const suggestions: string[] = [];
    if (canTxs) {
      suggestions.push('What are its biggest transactions?');
    }
    if (canFunder) {
      suggestions.push('Who funded this wallet?');
    }
    if (canCounterparties) {
      suggestions.push('Who does this wallet interact with?');
    }
    if (canTxs) {
      suggestions.push('Show its recent activity.');
    } else {
      suggestions.push('What is its current balance?');
    }
    if (canRelated && suggestions.length < 4) {
      suggestions.push('Show related wallets');
    }
    return suggestions;
  }

  if (target?.type === 'transaction') {
    return [
      'Who sent this transaction?',
      'Who was the recipient?',
      'What other transactions did this sender execute?',
    ];
  }

  if (target?.type === 'chain') {
    const chainName = target.chainDisplayName;
    return [
      `What are the biggest transactions on ${chainName}?`,
      `Who are the biggest whales on ${chainName}?`,
      `What is happening on ${chainName}?`,
    ];
  }

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

/**
 * Formats a WalletInvestigationResult into Telegram presentation markdown.
 */
export function formatWalletResult(
  result: WalletInvestigationResult,
  question: string,
  isBudgetLimited = false
): string {
  const lines: string[] = [];
  if (isBudgetLimited) {
    lines.push(
      '⚠️ The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    lines.push('');
  }

  const addr = result.target.label || truncateAddress(result.target.address);
  const chainName =
    result.target.chainDisplayName ||
    (result.target.chain ? result.target.chain.charAt(0).toUpperCase() + result.target.chain.slice(1) : 'Ethereum');

  lines.push('🔎 WALLET INVESTIGATION');
  lines.push(`${addr} · ${chainName}`);
  lines.push('');
  lines.push(`🔎 ${addr} — ${question}`);

  // CURRENT BALANCES
  lines.push('');
  lines.push('CURRENT BALANCES');
  if (result.balances.nativeAsset) {
    lines.push(`• ${result.balances.nativeAsset}`);
  }
  if (result.balances.tokenPositions && result.balances.tokenPositions.length > 0) {
    for (const pos of result.balances.tokenPositions) {
      lines.push(pos.startsWith('Token positions:') ? `• ${pos}` : `• Token positions: ${pos}`);
    }
  } else {
    lines.push('• Token positions: Current wallet balance data returned no token positions.');
  }
  if (result.balances.portfolioValue) {
    lines.push(`• Portfolio value: ${result.balances.portfolioValue}`);
  }

  // RECENT ACTIVITY
  if (result.recentActivity && result.recentActivity.length > 0) {
    lines.push('');
    lines.push('RECENT ACTIVITY');
    for (const act of result.recentActivity) {
      lines.push(`• ${act.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // LARGE / NOTABLE MOVEMENTS
  if (result.largeMovements && result.largeMovements.length > 0) {
    lines.push('');
    lines.push('LARGE / NOTABLE MOVEMENTS');
    for (const mov of result.largeMovements) {
      lines.push(`• ${mov.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // FUNDING
  if (result.funding && (result.funding.firstFunder || result.funding.firstFundingActivity)) {
    lines.push('');
    lines.push('FUNDING');
    if (result.funding.firstFunder) {
      lines.push(`• First funded by: ${result.funding.firstFunder}`);
    }
    if (result.funding.firstFundingActivity) {
      lines.push(`• First funding activity: ${result.funding.firstFundingActivity}`);
    }
  }

  // COUNTERPARTIES
  if (result.counterparties && result.counterparties.length > 0) {
    lines.push('');
    lines.push('COUNTERPARTIES');
    for (const cp of result.counterparties) {
      lines.push(`• ${cp.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // RELATED WALLETS
  if (result.relatedWallets && result.relatedWallets.length > 0) {
    lines.push('');
    lines.push('RELATED WALLETS');
    for (const rw of result.relatedWallets) {
      lines.push(`• ${rw.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // FINDINGS
  if (result.findings && result.findings.length > 0) {
    lines.push('');
    lines.push('FINDINGS');
    for (const f of result.findings) {
      lines.push(`• ${f.statement.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // NOT ESTABLISHED
  if (result.notEstablished && result.notEstablished.length > 0) {
    lines.push('');
    lines.push('NOT ESTABLISHED');
    for (const ne of result.notEstablished) {
      lines.push(`• ${ne.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // LIMITATIONS
  if (result.limitations && result.limitations.length > 0) {
    lines.push('');
    lines.push('LIMITATIONS');
    for (const lim of result.limitations) {
      lines.push(`• ${lim.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // EVIDENCE
  if (result.evidence && result.evidence.length > 0) {
    lines.push('');
    lines.push('EVIDENCE');
    for (const ev of result.evidence) {
      lines.push(`• ${ev.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  lines.push('');
  lines.push('Ask another question about this wallet.');
  if (result.followUps && result.followUps.length > 0) {
    lines.push(`Suggested: ${result.followUps.map((q) => `"${q}"`).join(' • ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats a TokenInvestigationResult into Telegram presentation markdown.
 */
export function formatTokenResult(
  result: TokenInvestigationResult,
  question: string,
  isBudgetLimited = false
): string {
  const lines: string[] = [];
  if (isBudgetLimited) {
    lines.push(
      '⚠️ The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    lines.push('');
  }

  const symbol = result.target.token.symbol;
  const chainName =
    result.target.chainDisplayName ||
    (result.target.token.chain.charAt(0).toUpperCase() + result.target.token.chain.slice(1));

  lines.push('🔎 TOKEN INVESTIGATION');
  lines.push(`${symbol} · ${chainName}`);
  lines.push('');
  lines.push(`🔎 ${symbol} — ${question}`);

  if (result.overview.marketContext) {
    lines.push('');
    lines.push(result.overview.marketContext);
  }

  // FINDINGS / OBSERVATIONS
  if (result.findings && result.findings.length > 0) {
    lines.push('');
    for (const f of result.findings.slice(0, 5)) {
      lines.push(`• ${f.statement.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // FLOW / ACTIVITY INTERPRETATION
  if (result.flowActivity.inflowsOutflows) {
    lines.push('');
    lines.push(result.flowActivity.inflowsOutflows);
  }

  // NOTABLE ACTIVITY
  if (result.notableActivity && result.notableActivity.length > 0) {
    lines.push('');
    lines.push('NOTABLE ACTIVITY');
    for (const act of result.notableActivity.slice(0, 3)) {
      lines.push(`• ${act.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // EVIDENCE
  if (result.evidence && result.evidence.length > 0) {
    lines.push('');
    lines.push('Evidence');
    for (const ev of result.evidence) {
      lines.push(`• ${ev.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  // LIMITATIONS
  if (result.limitations && result.limitations.length > 0) {
    lines.push('');
    lines.push('Not Proven');
    for (const lim of result.limitations) {
      lines.push(`• ${lim.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  lines.push('');
  lines.push(`Ask another question about ${symbol}.`);
  if (result.followUps && result.followUps.length > 0) {
    lines.push(`Suggested: ${result.followUps.map((q) => `"${q}"`).join(' • ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats a TransactionInvestigationResult into Telegram presentation markdown.
 */
export function formatTransactionResult(
  result: TransactionInvestigationResult,
  question: string,
  isBudgetLimited = false
): string {
  const lines: string[] = [];
  if (isBudgetLimited) {
    lines.push(
      '⚠️ The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    lines.push('');
  }

  const txHash = result.target.transactionHash;
  const shortHash = txHash.length > 14 ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}` : txHash;
  const chainName = result.target.chain
    ? result.target.chain.charAt(0).toUpperCase() + result.target.chain.slice(1)
    : 'Ethereum';

  lines.push('🔎 TRANSACTION INVESTIGATION');
  lines.push(`${shortHash} · ${chainName}`);
  lines.push('');
  lines.push(`🔎 ${shortHash} — ${question}`);

  if (result.status) {
    lines.push('');
    lines.push('STATUS');
    lines.push(`• ${result.status}`);
  }

  if (result.when) {
    lines.push('');
    lines.push('WHEN');
    lines.push(`• ${result.when}`);
  }

  if (result.from) {
    lines.push('');
    lines.push('FROM');
    lines.push(`• ${result.from}`);
  }

  if (result.to) {
    lines.push('');
    lines.push('TO');
    lines.push(`• ${result.to}`);
  }

  if (result.assetValue) {
    lines.push('');
    lines.push('ASSET / VALUE');
    lines.push(`• ${result.assetValue}`);
  }

  if (result.transactionType) {
    lines.push('');
    lines.push('TRANSACTION TYPE');
    lines.push(`• ${result.transactionType}`);
  }

  if (result.movement) {
    lines.push('');
    lines.push('MOVEMENT');
    lines.push(`• ${result.movement}`);
  }

  if (result.counterparties && result.counterparties.length > 0) {
    lines.push('');
    lines.push('COUNTERPARTIES');
    for (const cp of result.counterparties) {
      lines.push(`• ${cp.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.notableDetails && result.notableDetails.length > 0) {
    lines.push('');
    lines.push('NOTABLE DETAILS');
    for (const nd of result.notableDetails) {
      lines.push(`• ${nd.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.findings && result.findings.length > 0) {
    lines.push('');
    lines.push('FINDINGS');
    for (const f of result.findings) {
      lines.push(`• ${f.statement.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.notEstablished && result.notEstablished.length > 0) {
    lines.push('');
    lines.push('NOT ESTABLISHED');
    for (const ne of result.notEstablished) {
      lines.push(`• ${ne.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.limitations && result.limitations.length > 0) {
    lines.push('');
    lines.push('LIMITATIONS');
    for (const lim of result.limitations) {
      lines.push(`• ${lim.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.evidence && result.evidence.length > 0) {
    lines.push('');
    lines.push('EVIDENCE');
    for (const ev of result.evidence) {
      lines.push(`• ${ev.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  lines.push('');
  lines.push('Ask another question about this transaction.');
  if (result.followUps && result.followUps.length > 0) {
    lines.push(`Suggested: ${result.followUps.map((q) => `"${q}"`).join(' • ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats a ChainInvestigationResult into Telegram presentation markdown.
 */
export function formatChainResult(
  result: ChainInvestigationResult,
  question: string,
  isBudgetLimited = false
): string {
  const lines: string[] = [];
  if (isBudgetLimited) {
    lines.push(
      '⚠️ The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    lines.push('');
  }

  const chainName = result.target.chainDisplayName || result.target.chain;

  lines.push('🔎 CHAIN INVESTIGATION');
  lines.push(chainName);
  lines.push('');
  lines.push(`🔎 ${chainName} — ${question}`);

  lines.push('');
  lines.push('CHAIN OVERVIEW');
  lines.push(`• Network: ${result.overview.chain}`);
  if (result.overview.nativeAsset) {
    lines.push(`• Native Asset: ${result.overview.nativeAsset}`);
  }

  if (result.currentActivity) {
    lines.push('');
    lines.push('CURRENT ACTIVITY');
    lines.push(`• ${result.currentActivity.replace(/^[•\-\*]\s*/, '')}`);
  }

  if (result.largeTransactions && result.largeTransactions.length > 0) {
    lines.push('');
    lines.push('LARGE TRANSACTIONS');
    for (const tx of result.largeTransactions) {
      lines.push(`• ${tx.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.whaleSmartMoneyActivity && result.whaleSmartMoneyActivity.length > 0) {
    lines.push('');
    lines.push('WHALE / SMART MONEY ACTIVITY');
    for (const act of result.whaleSmartMoneyActivity) {
      lines.push(`• ${act.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.nativeAssetActivity) {
    lines.push('');
    lines.push('NATIVE ASSET ACTIVITY');
    lines.push(`• ${result.nativeAssetActivity.replace(/^[•\-\*]\s*/, '')}`);
  }

  if (result.notableMovements && result.notableMovements.length > 0) {
    lines.push('');
    lines.push('NOTABLE MOVEMENTS');
    for (const mov of result.notableMovements) {
      lines.push(`• ${mov.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.findings && result.findings.length > 0) {
    lines.push('');
    lines.push('FINDINGS');
    for (const f of result.findings) {
      lines.push(`• ${f.statement.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.notEstablished && result.notEstablished.length > 0) {
    lines.push('');
    lines.push('NOT ESTABLISHED');
    for (const ne of result.notEstablished) {
      lines.push(`• ${ne.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.limitations && result.limitations.length > 0) {
    lines.push('');
    lines.push('LIMITATIONS');
    for (const lim of result.limitations) {
      lines.push(`• ${lim.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  if (result.evidence && result.evidence.length > 0) {
    lines.push('');
    lines.push('EVIDENCE');
    for (const ev of result.evidence) {
      lines.push(`• ${ev.replace(/^[•\-\*]\s*/, '')}`);
    }
  }

  lines.push('');
  lines.push(`Ask another question about ${chainName}.`);
  if (result.followUps && result.followUps.length > 0) {
    lines.push(`Suggested: ${result.followUps.map((q) => `"${q}"`).join(' • ')}`);
  }

  return lines.join('\n');
}

/**
 * Dispatches formatting for any TypedInvestigationResult.
 */
export function formatTypedResult(
  typedResult: TypedInvestigationResult,
  question: string,
  isBudgetLimited = false
): string {
  switch (typedResult.targetType) {
    case 'wallet':
      return formatWalletResult(typedResult, question, isBudgetLimited);
    case 'token':
      return formatTokenResult(typedResult, question, isBudgetLimited);
    case 'transaction':
      return formatTransactionResult(typedResult, question, isBudgetLimited);
    case 'chain':
      return formatChainResult(typedResult, question, isBudgetLimited);
  }
}

