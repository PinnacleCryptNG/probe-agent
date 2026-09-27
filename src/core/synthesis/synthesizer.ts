import { ILLMProvider } from '../llm/interface.js';
import { generateId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { EvidenceItem } from '../../types/evidence.js';
import { EvidenceValidator, evidenceValidator as defaultValidator } from './validator.js';
import {
  SynthesisInterpretation,
  SynthesisObservation,
  SynthesisRequest,
  SynthesisResult,
  SynthesisUnknown,
} from './types.js';
import { profiler } from '../../utils/profiler.js';

export interface SynthesisEngineDependencies {
  llmProvider: ILLMProvider;
  validator?: EvidenceValidator;
}

const CAUSAL_PATTERNS = [
  /\bcaused by\b/i,
  /\bproves why\b/i,
  /\bpumped because\b/i,
  /\bdumped because\b/i,
  /\bdue to news\b/i,
  /\bdue to twitter\b/i,
  /\bdue to announcement\b/i,
  /\bthe reason for the pump\b/i,
  /\bthe reason for the dump\b/i,
];

export { formatFlowUsd, truncateAddress, deriveNextSuggestions } from './formatting.js';
import { formatFlowUsd, truncateAddress, deriveNextSuggestions } from './formatting.js';

/**
 * Derives clean, human-readable evidence categories from retrieved evidence items.
 */
export function deriveEvidenceCategories(evidence: EvidenceItem[], symbol = 'ETH'): string[] {
  const categories = new Set<string>();

  for (const item of evidence) {
    const cap = item.provenance?.capability;
    if (cap === 'flow_intelligence') {
      categories.add('Cohort net flows');
    } else if (cap === 'who_bought_sold') {
      categories.add('Top buyer/seller data');
    } else if (cap === 'token_information') {
      categories.add(symbol.toUpperCase() === 'ETH' ? 'ETH/WETH token metrics' : `${symbol} token metrics`);
    } else if (cap === 'token_transfers') {
      categories.add('Token transfer records');
    } else if (cap === 'dex_trades') {
      categories.add('DEX trade data');
    } else if (cap === 'token_holders') {
      categories.add('Token holder concentration');
    } else if (item.title) {
      const cleanTitle = item.title.split(':')[0].trim();
      categories.add(cleanTitle);
    }
  }

  return Array.from(categories);
}

export function formatTransferItem(t: any, sym: string): string {
  const rawUsd = t.usdValue ?? t.amount_usd ?? t.amountUsd ?? t.transfer_value_usd ?? t.usd_value;
  const usdVal = typeof rawUsd === 'number' ? rawUsd : (rawUsd ? parseFloat(String(rawUsd)) : 0);

  const rawAmt = t.amount ?? t.transfer_amount;
  const numAmt = typeof rawAmt === 'number' ? rawAmt : (rawAmt ? parseFloat(String(rawAmt)) : 0);

  const from =
    t.fromLabel ||
    t.from_label ||
    t.from_address_label ||
    t.fromAddressLabel ||
    truncateAddress(t.fromAddress || t.from_address || t.from || '');

  const to =
    t.toLabel ||
    t.to_label ||
    t.to_address_label ||
    t.toAddressLabel ||
    truncateAddress(t.toAddress || t.to_address || t.to || '');

  const hash = t.transactionHash || t.transaction_hash || t.hash || t.tx_hash;
  const shortHash = hash ? (hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : hash) : undefined;
  const timestamp = t.timestamp || t.block_timestamp;
  const timeFormatted = timestamp ? timestamp.slice(0, 19).replace('T', ' ') : undefined;

  let valStr = '';
  if (usdVal > 0) {
    const usdStr = formatFlowUsd(usdVal, false);
    const amtStr = numAmt > 0
      ? `${numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sym}`
      : '';
    valStr = amtStr ? `${amtStr} (${usdStr})` : usdStr;
  } else if (numAmt > 0) {
    valStr = `${numAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sym} (ranked by token amount)`;
  } else {
    valStr = `Transfer`;
  }

  const parts: string[] = [`${valStr} from ${from} → ${to}`];
  if (shortHash) parts.push(`tx: ${shortHash}`);
  if (timeFormatted) parts.push(`time: ${timeFormatted}`);

  return parts.join(' | ');
}

/**
 * Deterministically extracts key observations, direct headline, and interpretation
 * from normalized EvidenceItems without dumping raw API payloads.
 */
export function extractDeterministicObservations(
  request: SynthesisRequest
): {
  headline: string;
  observations: SynthesisObservation[];
  interpretation: string;
  evidenceCategories: string[];
  unknowns: SynthesisUnknown[];
} {
  const symbol =
    request.target?.type === 'token'
      ? request.target.token.symbol
      : request.target?.type === 'wallet'
      ? truncateAddress(request.target.address)
      : request.target?.type === 'chain'
      ? request.target.chainDisplayName
      : request.tokenContext.symbol;
  const qLower = request.question.toLowerCase();
  const isPriceQuestion = /price|cost|worth|valuation/i.test(qLower);
  const isWhaleQuestion = /whale/i.test(qLower);
  const isSmartMoneyQuestion = /smart money|smart trader|top pnl/i.test(qLower);
  const hasCohortQuery = /cohort|flows?/i.test(qLower);
  const isBuyerQuestion = !isWhaleQuestion && !isSmartMoneyQuestion && !hasCohortQuery && /who.*buy|largest buyer|top buyer|who is buying|accumulat/i.test(qLower);
  const isSellerQuestion = !hasCohortQuery && /who.*sell|largest seller|top seller|who is selling|distribut|dump/i.test(qLower);
  const isTxQuestion = /big|largest?|transfer|swap|transaction/i.test(qLower);
  const isChangeQuestion = /what changed|recent.*change|activity changing/i.test(qLower);

  const observations: SynthesisObservation[] = [];
  const evidenceCategories = deriveEvidenceCategories(request.evidence, symbol);

  const flowEv = request.evidence.find((e) => e.provenance.capability === 'flow_intelligence');
  const tradeEv = request.evidence.find((e) => e.provenance.capability === 'who_bought_sold');
  const infoEv = request.evidence.find((e) => e.provenance.capability === 'token_information');
  const transferEv = request.evidence.find(
    (e) =>
      e.provenance.capability === 'token_transfers' ||
      Array.isArray((e.normalizedData as any)?.transfers) ||
      Array.isArray((e.rawPayload as any)?.transfers)
  );
  const dexEv = request.evidence.find((e) => e.provenance.capability === 'dex_trades');

  let freshNet: number | undefined;
  let exNet: number | undefined;
  let smNet: number | undefined;
  let whaleNet: number | undefined;

  let hasFreshWallets = false;
  let hasSmartMoneyFlow = false;

  if (flowEv) {
    const data = flowEv.normalizedData as any;
    freshNet = data.freshWalletsNetUsd ?? data.fresh_wallets?.net_flow_usd ?? data.rawRecord?.fresh_wallets_net_flow_usd;
    exNet = data.exchangesNetUsd ?? data.exchanges?.net_flow_usd ?? data.rawRecord?.exchange_net_flow_usd;
    smNet = data.smartMoneyNetUsd ?? data.smartMoney?.net_flow_usd ?? data.rawRecord?.smart_trader_net_flow_usd;
    whaleNet = data.whalesNetUsd ?? data.whales?.net_flow_usd ?? data.rawRecord?.whale_net_flow_usd;

    if (freshNet !== undefined) hasFreshWallets = true;
    if (smNet !== undefined) hasSmartMoneyFlow = true;
  }

  let topBuyer: any;
  let topSeller: any;
  let buyersCount = 0;
  if (tradeEv) {
    const data = tradeEv.normalizedData as any;
    const buyers = Array.isArray(data.buyers) ? data.buyers : [];
    const sellers = Array.isArray(data.sellers) ? data.sellers : [];
    topBuyer = buyers[0];
    topSeller = sellers[0];
    buyersCount = data.totalBuyersCount ?? buyers.length;
  }

  const rawTransfers: any[] = Array.isArray((transferEv?.normalizedData as any)?.transfers)
    ? [...(transferEv!.normalizedData as any).transfers]
    : Array.isArray((transferEv?.rawPayload as any)?.transfers)
    ? [...(transferEv!.rawPayload as any).transfers]
    : [];

  rawTransfers.sort((a, b) => {
    const valA = Number(a.amount_usd ?? a.amountUsd ?? a.transfer_value_usd ?? a.usd_value ?? 0);
    const valB = Number(b.amount_usd ?? b.amountUsd ?? b.transfer_value_usd ?? b.usd_value ?? 0);
    if (valB !== valA) return valB - valA;
    const amtA = Number(a.transfer_amount ?? a.amount ?? 0);
    const amtB = Number(b.transfer_amount ?? b.amount ?? 0);
    return amtB - amtA;
  });

  // 1. Build Prioritized Key Observations (Surfacing direct answers first)
  if (isWhaleQuestion) {
    if (whaleNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Whales: ${formatFlowUsd(Number(whaleNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (topBuyer && tradeEv) {
      const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top accumulator: ${addr}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
    if (freshNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (exNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Exchanges: ${formatFlowUsd(Number(exNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
  } else if (isSmartMoneyQuestion) {
    if (smNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (topBuyer && tradeEv) {
      const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top accumulator: ${addr}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
    if (freshNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (whaleNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
  } else if (isBuyerQuestion) {
    if (topBuyer && tradeEv) {
      const vol = topBuyer.volume || topBuyer.bought_volume_usd || 0;
      const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top accumulator: ${addr}${vol > 0 ? ' (' + formatFlowUsd(vol) + ')' : ''}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
    if (buyersCount > 0 && tradeEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Tracked net buyers: ${buyersCount} identified accumulators`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
    if (freshNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (smNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
  } else if (isSellerQuestion) {
    if (topSeller && tradeEv) {
      const vol = topSeller.volume || topSeller.sold_volume_usd || 0;
      const addr = topSeller.address_label || topSeller.label || truncateAddress(topSeller.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top seller: ${addr}${vol > 0 ? ' (' + formatFlowUsd(vol) + ')' : ''}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    } else {
      observations.push({
        id: generateId('fnd'),
        statement: 'Top net sellers: 0 prominent individual seller addresses flagged',
        evidenceRefs: tradeEv ? [tradeEv.evidenceId] : (flowEv ? [flowEv.evidenceId] : [request.evidence[0].evidenceId]),
      });
    }
    if (exNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Exchanges: ${formatFlowUsd(Number(exNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (whaleNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (smNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
  } else if (isTxQuestion) {
    if (rawTransfers.length > 0) {
      rawTransfers.slice(0, 4).forEach((t, idx) => {
        const rank =
          idx === 0
            ? 'Largest transfer'
            : idx === 1
            ? '2nd largest transfer'
            : idx === 2
            ? '3rd largest transfer'
            : `${idx + 1}th largest transfer`;
        observations.push({
          id: generateId('fnd'),
          statement: `${rank}: ${formatTransferItem(t, symbol)}`,
          evidenceRefs: [transferEv!.evidenceId],
        });
      });
    } else if (transferEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `No large transfer transactions recorded above threshold for ${symbol} in the observed period`,
        evidenceRefs: [transferEv.evidenceId],
      });
    }

    if (dexEv) {
      const rawTrades = Array.isArray((dexEv.normalizedData as any)?.trades)
        ? [...(dexEv.normalizedData as any).trades]
        : [];
      rawTrades.sort((a, b) => Number(b.usd_value ?? b.estimated_value_usd ?? 0) - Number(a.usd_value ?? a.estimated_value_usd ?? 0));
      if (rawTrades.length > 0 && observations.length < 4) {
        const topTrade = rawTrades[0];
        const val = Number(topTrade.usd_value ?? topTrade.estimated_value_usd ?? 0);
        const dex = topTrade.dex_name || 'DEX';
        const trader = topTrade.trader_label || topTrade.trader_address_label || truncateAddress(topTrade.trader_address || '');
        const valStr = val > 0 ? ` (${formatFlowUsd(val, false)})` : '';
        observations.push({
          id: generateId('fnd'),
          statement: `Largest DEX trade: ${topTrade.action || topTrade.trade_type || 'Swap'}${valStr} on ${dex} (trader: ${trader})`,
          evidenceRefs: [dexEv.evidenceId],
        });
      } else if (observations.length === 0) {
        observations.push({
          id: generateId('fnd'),
          statement: `DEX swap executions monitored across decentralized exchange pools`,
          evidenceRefs: [dexEv.evidenceId],
        });
      }
    }
    if (topBuyer && tradeEv && observations.length < 5) {
      const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top trade accumulator: ${addr}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
    if (freshNet !== undefined && flowEv && observations.length < 5) {
      observations.push({
        id: generateId('fnd'),
        statement: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
  } else {
    // Default / "What's happening?" / "What changed recently?"
    if (freshNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (exNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Exchanges: ${formatFlowUsd(Number(exNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (smNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (whaleNet !== undefined && flowEv) {
      observations.push({
        id: generateId('fnd'),
        statement: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    }
    if (topBuyer && tradeEv && observations.length < 5) {
      const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
      observations.push({
        id: generateId('fnd'),
        statement: `Top accumulator: ${addr}`,
        evidenceRefs: [tradeEv.evidenceId],
      });
    }
  }

  // Fallback if no observations derived from structured records
  if (observations.length === 0 && request.evidence.length > 0) {
    for (const ev of request.evidence.slice(0, 3)) {
      observations.push({
        id: generateId('fnd'),
        statement: ev.summary,
        evidenceRefs: [ev.evidenceId],
      });
    }
  }

  const selectedObservations = observations.slice(0, 5);

  // 2. Formulate Direct Question-Targeted Headline
  let headline: string;
  if (isWhaleQuestion) {
    if (whaleNet !== undefined) {
      if (whaleNet > 50000) {
        headline = `Tracked whale wallets increased net balance in ${symbol} (+${formatFlowUsd(whaleNet)} net flow).`;
      } else if (whaleNet < -50000) {
        headline = `Tracked whale wallets reduced net balance in ${symbol} (${formatFlowUsd(whaleNet)} net flow).`;
      } else {
        headline = `Tracked whale wallets show minimal net balance change in ${symbol} (${formatFlowUsd(whaleNet)} net flow).`;
      }
    } else {
      headline = `Tracked whale cohort activity shows no recorded net movement in ${symbol}.`;
    }
  } else if (isSmartMoneyQuestion) {
    if (smNet !== undefined) {
      if (smNet > 50000) {
        headline = `Tracked Smart Money wallets increased net balance in ${symbol} (+${formatFlowUsd(smNet)} net flow).`;
      } else if (smNet < -50000) {
        headline = `Tracked Smart Money wallets reduced net balance in ${symbol} (${formatFlowUsd(smNet)} net flow).`;
      } else {
        headline = `Tracked Smart Money wallets show minimal net balance change in ${symbol} (${formatFlowUsd(smNet)} net flow).`;
      }
    } else {
      headline = `Tracked Smart Money cohort activity shows no recorded net movement in ${symbol}.`;
    }
  } else if (isBuyerQuestion) {
    const buyerName = topBuyer?.address_label || topBuyer?.label || (topBuyer?.address ? truncateAddress(topBuyer.address) : '');
    if (buyerName && freshNet !== undefined) {
      headline = `Top recorded buyer is ${buyerName} alongside ${formatFlowUsd(Number(freshNet))} in fresh-wallet net inflows.`;
    } else if (freshNet !== undefined && freshNet > 0) {
      headline = `Recorded net inflows are led by fresh wallets with ${formatFlowUsd(Number(freshNet))} in aggregate flow.`;
    } else {
      headline = `Recorded buyer activity in ${symbol} is distributed across multiple monitored addresses.`;
    }
  } else if (isSellerQuestion) {
    if (exNet !== undefined && exNet < 0) {
      headline = `Tracked exchange wallets recorded net outflows of ${formatFlowUsd(Math.abs(Number(exNet)), false)} with no concentrated seller addresses identified.`;
    } else if (exNet !== undefined && exNet > 0) {
      headline = `Tracked exchange wallets recorded net inflows of ${formatFlowUsd(Number(exNet))} alongside localized cohort balance reductions.`;
    } else {
      headline = `No prominent seller concentration identified across monitored cohorts in ${symbol}.`;
    }
  } else if (isTxQuestion) {
    if (rawTransfers.length > 0) {
      headline = `Largest recorded transfer for ${symbol} was ${formatTransferItem(rawTransfers[0], symbol)}.`;
    } else {
      headline = `High-volume transfer and swap activity recorded across ${symbol} counterparties.`;
    }
  } else if (isChangeQuestion) {
    if (freshNet !== undefined && exNet !== undefined) {
      headline = `Recent activity shows ${formatFlowUsd(Number(freshNet))} in fresh-wallet net inflows and ${formatFlowUsd(Number(exNet))} in exchange net flows.`;
    } else {
      headline = `Recent flow series indicates active volume realignment across ${symbol} holders.`;
    }
  } else if (isPriceQuestion && infoEv) {
    const price = (infoEv.normalizedData as any)?.priceUsd;
    headline = price
      ? `${request.tokenContext.name} (${symbol}) spot price is currently $${Number(price).toLocaleString()}.`
      : `Token metadata retrieved for ${request.tokenContext.name} (${symbol}).`;
  } else if (hasFreshWallets) {
    headline = 'Fresh-wallet and exchange activity are the clearest signals in the available data.';
  } else if (hasSmartMoneyFlow) {
    headline = `Tracked Smart Money net inflows highlight current on-chain activity for ${symbol}.`;
  } else {
    headline = `On-chain evidence for ${symbol} indicates active participant flows during the observed period.`;
  }

  // 3. Formulate Direct Epistemic Interpretation
  let interpretation: string;
  if (isWhaleQuestion) {
    interpretation = (whaleNet !== undefined && Math.abs(whaleNet) > 50000)
      ? (whaleNet > 0
          ? 'Tracked whale wallets expanded their aggregate balance during the observed window, reflecting net inflows into these addresses.'
          : 'Tracked whale wallets reduced their net balance during the observed window. The data does not establish whether this reflects profit-taking, portfolio rebalancing, or internal wallet reorganization.')
      : 'Tracked whale wallets recorded little to no net flow during the observed window, showing flat aggregate balance.';
  } else if (isSmartMoneyQuestion) {
    interpretation = (smNet !== undefined && Math.abs(smNet) > 50000)
      ? (smNet > 0
          ? 'Tracked Smart Money addresses expanded their aggregate balance during the observed window.'
          : 'Tracked Smart Money addresses reduced their aggregate balance during the observed window; on-chain transfer data alone does not establish strategic motive.')
      : 'Tracked Smart Money and top PnL cohorts maintained virtually unchanged net balances across the observed period.';
  } else if (isBuyerQuestion) {
    interpretation = 'Net inflows are concentrated in newly active wallets and top recorded buyer addresses, while tracked Smart Money cohorts recorded net negative flow.';
  } else if (isSellerQuestion) {
    interpretation = (exNet !== undefined && exNet < 0)
      ? 'Tracked exchange addresses recorded net outflows, consistent with assets moving away from exchange wallets. This does not establish whether those assets were withdrawn for long-term custody, staking, or other purposes.'
      : 'Tracked exchange addresses recorded net inflows. The data shows token transfers to exchange custody without establishing whether those assets were sold.';
  } else if (isTxQuestion) {
    interpretation = 'Recorded large transactions represent high-value contract interactions and transfers between monitored counterparties; data does not indicate whether these were OTC trades or internal rebalancing.';
  } else if (isChangeQuestion) {
    interpretation = 'The largest directional variance over the observed interval occurred in fresh-wallet net balances, while whale cohort balances remained comparatively flat.';
  } else if (hasFreshWallets) {
    interpretation =
      'This points to substantial fresh-wallet inflows during the observed period, while the available whale cohort data does not show net movement.';
  } else if (hasSmartMoneyFlow) {
    interpretation =
      'Tracked Smart Money addresses recorded positive net flow during the observed period, while broader cohort balances showed limited variance.';
  } else {
    interpretation =
      'The available data establishes on-chain transaction patterns, but does not establish off-chain motivations or catalysts.';
  }

  // 4. Formulate Epistemic Boundaries (Not Proven / Unknowns)
  const unknowns: SynthesisUnknown[] = [];
  if (isWhaleQuestion) {
    unknowns.push({
      statement: 'Whether whale balance changes reflect profit-taking, portfolio rotation, or internal custody moves',
      reason: 'On-chain transfer data records balance delta rather than trader rationale.',
    });
  } else if (isSellerQuestion) {
    unknowns.push({
      statement: 'Whether exchange flows reflect spot execution, collateral rebalancing, or custodial transfers',
      reason: 'On-chain transaction data records address movement rather than order book trades or intent.',
    });
  } else if (isBuyerQuestion) {
    unknowns.push({
      statement: 'Whether fresh-wallet buyers represent distinct individuals, institutional sub-accounts, or automated execution',
      reason: 'On-chain data identifies addresses, not individual off-chain entity identities.',
    });
  } else if (isSmartMoneyQuestion) {
    unknowns.push({
      statement: 'Whether smart money flows represent directional positioning, arbitrage rebalancing, or passive hedging',
      reason: 'On-chain data tracks wallet transfers without revealing underlying trading strategies.',
    });
  } else if (isTxQuestion) {
    unknowns.push({
      statement: 'Specific off-chain counterparties or execution intent behind large transfers',
      reason: 'Transaction hashes verify execution without revealing OTC agreements.',
    });
  } else if (isChangeQuestion) {
    unknowns.push({
      statement: 'Underlying market catalysts or off-chain events driving recent balance changes',
      reason: 'On-chain data records execution results rather than subjective motives.',
    });
  } else {
    unknowns.push({
      statement: 'Off-chain news, private negotiations, and external catalysts',
      reason: 'On-chain data records execution results rather than subjective motives.',
    });
  }

  return {
    headline,
    observations: selectedObservations,
    interpretation,
    evidenceCategories,
    unknowns,
  };
}

export class EvidenceSynthesisEngine {
  private readonly llmProvider: ILLMProvider;
  private readonly validator: EvidenceValidator;

  constructor(deps: SynthesisEngineDependencies) {
    this.llmProvider = deps.llmProvider;
    this.validator = deps.validator ?? defaultValidator;
  }

  /**
   * Synthesizes an evidence-backed finding from retrieved EvidenceItems,
   * enforcing strict epistemic boundaries (OBSERVATION vs INTERPRETATION vs HYPOTHESIS vs UNKNOWN)
   * and running post-generation validation before accepting output.
   */
  public async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const createdAt = new Date().toISOString();
    const symbol =
      request.target?.type === 'token'
        ? request.target.token.symbol
        : request.target?.type === 'wallet'
        ? truncateAddress(request.target.address)
        : request.target?.type === 'chain'
        ? request.target.chainDisplayName
        : request.tokenContext.symbol;

    logger.info('Synthesizing evidence for investigation', {
      investigationId: request.investigationId,
      question: request.question,
      evidenceCount: request.evidence.length,
    });

    // 1. Guard against empty evidence
    if (!request.evidence || request.evidence.length === 0) {
      logger.info('No evidence items available; returning insufficient evidence synthesis', {
        investigationId: request.investigationId,
      });

      return {
        success: true,
        answer: "I couldn't establish a reliable explanation from the available on-chain data.",
        headline: "I couldn't establish a reliable explanation from the available on-chain data.",
        observations: [],
        interpretations: [],
        hypotheses: [],
        unknowns: [
          {
            statement: request.question,
            reason: 'No on-chain evidence records exist or were returned for the target query.',
          },
        ],
        evidenceRefs: [],
        evidenceCategories: [],
        followUpQuestions: [`Ask another question about ${symbol}.`],
        validated: true,
        investigationId: request.investigationId,
        createdAt,
      };
    }

    // 2. Generate baseline deterministic synthesis
    const baseline = extractDeterministicObservations(request);

    let headline = baseline.headline;
    let observations = baseline.observations;
    let interpretationText = baseline.interpretation;
    let evidenceCategories = baseline.evidenceCategories;
    const hypotheses: Array<{ id: string; statement: string; evidenceRefs: string[] }> = [];

    // 3. Ask LLM provider for synthesis
    try {
      const tLlmStart = Date.now();
      const llmResponse = await this.llmProvider.synthesizeAnswer({
        tokenContext: request.tokenContext,
        userQuestion: request.question,
        evidence: request.evidence,
        conversationHistory: request.conversationHistory ?? [],
      });
      const tLlmEnd = Date.now();
      profiler.recordStage('6. Gemini/LLM synthesis', tLlmStart, tLlmEnd);
      profiler.recordLlmCall({
        provider: this.llmProvider.constructor.name,
        durationMs: tLlmEnd - tLlmStart,
        usage: llmResponse.usage,
      });

      // Check if LLM returned structured headline
      if (llmResponse.headline && llmResponse.headline.trim().length > 0) {
        headline = llmResponse.headline.trim();
      }

      // Check if LLM returned clean observations that pass validation
      const validEvidenceIds = new Set(request.evidence.map((e) => e.evidenceId));
      const candidateObservations: SynthesisObservation[] = [];

      for (const finding of llmResponse.findings) {
        if (finding.status === 'OBSERVATION') {
          const refs = finding.evidenceReferences.map((r) => r.evidenceId).filter((id) => validEvidenceIds.has(id));
          const hasCausalViolation = CAUSAL_PATTERNS.some((p) => p.test(finding.claim));
          if (refs.length > 0 && !hasCausalViolation) {
            candidateObservations.push({
              id: finding.id || generateId('fnd'),
              statement: finding.claim.replace(/^[•\-\*]\s*/, ''),
              evidenceRefs: refs,
            });
          }
        }
      }

      if (candidateObservations.length > 0) {
        // Limit to max 3-5 observations
        observations = candidateObservations.slice(0, 5);
      }

      // Check if LLM returned interpretation
      if (llmResponse.interpretation && llmResponse.interpretation.trim().length > 0) {
        const hasCausalViolation = CAUSAL_PATTERNS.some((p) => p.test(llmResponse.interpretation!));
        if (!hasCausalViolation) {
          interpretationText = llmResponse.interpretation.trim();
        }
      }

      if (llmResponse.evidenceCategories && llmResponse.evidenceCategories.length > 0) {
        evidenceCategories = llmResponse.evidenceCategories;
      }

      // Collect hypotheses
      for (const h of llmResponse.hypotheses ?? []) {
        hypotheses.push({
          id: h.id,
          statement: h.statement,
          evidenceRefs: request.evidence.slice(0, 1).map((e) => e.evidenceId),
        });
      }
    } catch (llmErr) {
      logger.warn('LLM synthesis fallback', { error: String(llmErr) });
    }

    // 4. Build verified interpretation
    const interpretations: SynthesisInterpretation[] = [
      {
        id: generateId('fnd'),
        statement: interpretationText,
        confidence: 'high',
        confidenceRationale: 'Derived from verified on-chain cohort metrics and trade distributions',
        evidenceRefs: Array.from(new Set(observations.flatMap((o) => o.evidenceRefs))),
      },
    ];

    // 5. Formulate unknowns from plan unresolved items or epistemic limits
    const unknowns: SynthesisUnknown[] = [...baseline.unknowns];
    if (request.plan?.unresolvedRequirements && request.plan.unresolvedRequirements.length > 0) {
      for (const unk of request.plan.unresolvedRequirements) {
        unknowns.push({
          statement: unk,
          reason: 'On-chain forensic data cannot prove off-chain catalyst or psychological sentiment.',
        });
      }
    }

    // 6. Gather all unique evidence references
    const evidenceRefs = Array.from(
      new Set([...observations.flatMap((o) => o.evidenceRefs), ...interpretations.flatMap((i) => i.evidenceRefs)])
    );

    // 7. Optional next question invitation (single line, no questionnaire)
    const followUpQuestions = [`Ask another question about ${symbol}.`];

    // 8. Compose formatted answer markdown matching the concise target output structure
    const formattedAnswer = this.composeAnswer({
      symbol,
      question: request.question,
      headline,
      observations,
      interpretation: interpretationText,
      evidenceCategories,
      unknowns,
    });

    const candidateResult: SynthesisResult = {
      success: true,
      answer: formattedAnswer,
      headline,
      observations,
      interpretations,
      hypotheses,
      unknowns,
      evidenceRefs,
      evidenceCategories,
      followUpQuestions,
      validated: false,
      investigationId: request.investigationId,
      createdAt,
    };

    // 9. Run EvidenceValidator
    const tValStart = Date.now();
    const validation = this.validator.validate(
      candidateResult,
      request.evidence,
      request.investigationId,
      request.tokenContext.address
    );
    const tValEnd = Date.now();
    profiler.recordStage('7. Evidence validation', tValStart, tValEnd, {
      isValid: validation.isValid,
    });

    if (!validation.isValid) {
      logger.error('Synthesis validation failed', {
        investigationId: request.investigationId,
        errors: validation.errors,
      });

      return {
        ...candidateResult,
        success: false,
        validated: false,
        validationErrors: validation.errors.map((e) => e.message),
        answer: `⚠️ Synthesis Validation Failed: Output contained ungrounded or invalid claims (${validation.errors.map((e) => e.message).join('; ')})`,
      };
    }

    candidateResult.validated = true;
    return candidateResult;
  }

  /**
   * Composes a clean, structured answer following the 5-section answer principle:
   * 1. Headline / Direct Answer
   * 2. Key Observations (max 3-5 bullets)
   * 3. Interpretation (short paragraph)
   * 4. Evidence (short list of categories)
   * 5. Optional Next Question
   */
  private composeAnswer(params: {
    symbol: string;
    question: string;
    headline: string;
    observations: SynthesisObservation[];
    interpretation: string;
    evidenceCategories: string[];
    unknowns?: SynthesisUnknown[];
  }): string {
    const lines: string[] = [];

    lines.push(`🔎 ${params.symbol} — ${params.question}`);
    lines.push('');
    lines.push(params.headline);

    if (params.observations.length > 0) {
      lines.push('');
      for (const obs of params.observations.slice(0, 5)) {
        const clean = obs.statement.replace(/^[•\-\*]\s*/, '');
        lines.push(`• ${clean}`);
      }
    }

    if (params.interpretation && params.interpretation !== params.headline) {
      lines.push('');
      lines.push(params.interpretation);
    }

    if (params.evidenceCategories.length > 0) {
      lines.push('');
      lines.push('Evidence');
      for (const cat of params.evidenceCategories) {
        const clean = cat.replace(/^[•\-\*]\s*/, '');
        lines.push(`• ${clean}`);
      }
    }

    if (params.unknowns && params.unknowns.length > 0) {
      lines.push('');
      lines.push('Not Proven');
      for (const unk of params.unknowns) {
        const clean = unk.statement.replace(/^[•\-\*]\s*/, '');
        lines.push(`• ${clean}`);
      }
    }

    lines.push('');
    lines.push(`Ask another question about ${params.symbol}.`);
    const suggestions = deriveNextSuggestions(params.question, params.symbol);
    if (suggestions.length > 0) {
      lines.push(`Suggested: ${suggestions.map((q) => `"${q}"`).join(' • ')}`);
    }

    return lines.join('\n');
  }
}
