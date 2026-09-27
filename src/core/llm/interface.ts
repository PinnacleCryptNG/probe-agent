import { generateId } from '../../utils/ids.js';
import { formatFlowUsd, truncateAddress, deriveNextSuggestions } from '../synthesis/formatting.js';
import { formatTransferItem } from '../synthesis/synthesizer.js';
import {
  LLMChallengeRequest,
  LLMChallengeResponse,
  LLMPlanningRequest,
  LLMPlanningResponse,
  LLMSynthesisRequest,
  LLMSynthesisResponse,
} from './types.js';

export interface ILLMProvider {
  readonly providerName: string;
  planInvestigation(request: LLMPlanningRequest): Promise<LLMPlanningResponse>;
  synthesizeAnswer(request: LLMSynthesisRequest): Promise<LLMSynthesisResponse>;
  evaluateChallenge(request: LLMChallengeRequest): Promise<LLMChallengeResponse>;
}

/**
 * Mock LLM Provider for unit testing and offline development.
 * Produces structured planning and synthesis following the epistemic model.
 */
export class MockLLMProvider implements ILLMProvider {
  public readonly providerName = 'mock';

  public async planInvestigation(request: LLMPlanningRequest): Promise<LLMPlanningResponse> {
    const q = request.userQuestion.toLowerCase();

    // Dynamically pick 1-2 capabilities based on question keywords
    const selectedCapabilities: Array<{ name: string; reason: string; cost: number }> = [];

    if (q.includes('pump') || q.includes('dump') || q.includes('flow') || q.includes('activity')) {
      selectedCapabilities.push({
        name: 'flow_intelligence',
        reason: 'Inspect cohort-level inflows/outflows for smart money and whales',
        cost: 1,
      });
      selectedCapabilities.push({
        name: 'who_bought_sold',
        reason: 'Identify top net accumulating or distributing entities',
        cost: 1,
      });
    } else if (q.includes('holder') || q.includes('supply') || q.includes('whales')) {
      selectedCapabilities.push({
        name: 'token_holders',
        reason: 'Assess top holder concentration and distribution',
        cost: 5,
      });
    } else if (q.includes('dex') || q.includes('trade') || q.includes('swap')) {
      selectedCapabilities.push({
        name: 'dex_trades',
        reason: 'Examine DEX swap patterns and volume',
        cost: 1,
      });
    } else {
      selectedCapabilities.push({
        name: 'token_information',
        reason: 'Fetch baseline spot metrics and token status',
        cost: 1,
      });
    }

    // Limit to maxCallsAllowed
    const sliced = selectedCapabilities.slice(0, request.maxCallsAllowed);

    const evidenceRequirements = sliced.map((c, index) => ({
      id: generateId('req'),
      capabilityName: c.name,
      reason: c.reason,
      parameters: {
        token_address: request.tokenContext.address,
        chain: request.tokenContext.chain,
      },
      priority: index + 1,
      estimatedCost: c.cost,
    }));

    return {
      intent: {
        category: q.includes('pump')
          ? 'ACCUMULATION_INSPECTION'
          : q.includes('holder')
          ? 'HOLDER_CONCENTRATION'
          : 'GENERAL_INQUIRY',
        summary: `Analyze ${request.tokenContext.symbol} in response to: "${request.userQuestion}"`,
        confidence: 0.92,
      },
      evidenceRequirements,
      reasoningSummary: `Selected ${evidenceRequirements.length} capability/capabilities to gather verified evidence without exceeding turn budgets.`,
    };
  }

  public async synthesizeAnswer(request: LLMSynthesisRequest): Promise<LLMSynthesisResponse> {
    const symbol = request.tokenContext.symbol;
    const qLower = request.userQuestion.toLowerCase();
    const isPriceQuestion = /price|cost|worth|valuation/i.test(qLower);
    const isWhaleQuestion = /whale/i.test(qLower);
    const isSmartMoneyQuestion = /smart money|smart trader|top pnl/i.test(qLower);
    const hasCohortQuery = /cohort|flows?/i.test(qLower);
    const isBuyerQuestion = !isWhaleQuestion && !isSmartMoneyQuestion && !hasCohortQuery && /who.*buy|largest buyer|top buyer|who is buying|accumulat/i.test(qLower);
    const isSellerQuestion = !hasCohortQuery && /who.*sell|largest seller|top seller|who is selling|distribut|dump/i.test(qLower);
    const isTxQuestion = /big|largest?|transfer|swap|transaction/i.test(qLower);
    const isChangeQuestion = /what changed|recent.*change|activity changing/i.test(qLower);

    // 1. Identify relevant evidence items and categories
    const evidenceCategories: string[] = [];
    const observations: Array<{ claim: string; evidenceId: string }> = [];

    const flowEv = request.evidence.find((e) => e.provenance.capability === 'flow_intelligence');
    const tradeEv = request.evidence.find((e) => e.provenance.capability === 'who_bought_sold');
    const infoEv = request.evidence.find((e) => e.provenance.capability === 'token_information');
    const txEv = request.evidence.find(
      (e) =>
        e.provenance.capability === 'token_transfers' ||
        Array.isArray((e.normalizedData as any)?.transfers) ||
        Array.isArray((e.rawPayload as any)?.transfers)
    );
    const dexEv = request.evidence.find((e) => e.provenance.capability === 'dex_trades');

    if (flowEv) evidenceCategories.push('Cohort net flows');
    if (tradeEv) evidenceCategories.push('Top buyer/seller data');
    if (infoEv) evidenceCategories.push(symbol.toUpperCase() === 'ETH' ? 'ETH/WETH token metrics' : `${symbol} token metrics`);
    if (txEv) evidenceCategories.push('Token transfer records');
    if (dexEv) evidenceCategories.push('DEX trade data');

    let freshNet: number | undefined;
    let exNet: number | undefined;
    let smNet: number | undefined;
    let whaleNet: number | undefined;

    let hasFreshWallets = false;
    let hasSmartMoneyFlow = false;

    if (flowEv) {
      const data = flowEv.normalizedData as any;
      freshNet = data.freshWalletsNetUsd ?? data.fresh_wallets?.net_flow_usd;
      exNet = data.exchangesNetUsd ?? data.exchanges?.net_flow_usd;
      smNet = data.smartMoneyNetUsd ?? data.smartMoney?.net_flow_usd;
      whaleNet = data.whalesNetUsd ?? data.whales?.net_flow_usd;

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

    // Build Prioritized Observations (Max 3-5)
    if (isWhaleQuestion) {
      if (whaleNet !== undefined && flowEv) {
        observations.push({
          claim: `Whales: ${formatFlowUsd(Number(whaleNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (topBuyer && tradeEv) {
        const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        observations.push({
          claim: `Top accumulator: ${addr}`,
          evidenceId: tradeEv.evidenceId,
        });
      }
      if (freshNet !== undefined && flowEv) {
        observations.push({
          claim: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (exNet !== undefined && flowEv) {
        observations.push({
          claim: `Exchanges: ${formatFlowUsd(Number(exNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
    } else if (isSmartMoneyQuestion) {
      if (smNet !== undefined && flowEv) {
        observations.push({
          claim: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (topBuyer && tradeEv) {
        const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        observations.push({
          claim: `Top accumulator: ${addr}`,
          evidenceId: tradeEv.evidenceId,
        });
      }
      if (freshNet !== undefined && flowEv) {
        observations.push({
          claim: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (whaleNet !== undefined && flowEv) {
        observations.push({
          claim: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
    } else if (isBuyerQuestion) {
      if (topBuyer && tradeEv) {
        const vol = topBuyer.volume || topBuyer.bought_volume_usd || 0;
        const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        observations.push({
          claim: `Top accumulator: ${addr}${vol > 0 ? ' (' + formatFlowUsd(vol) + ')' : ''}`,
          evidenceId: tradeEv.evidenceId,
        });
      }
      if (buyersCount > 0 && tradeEv) {
        observations.push({
          claim: `Tracked net buyers: ${buyersCount} identified accumulators`,
          evidenceId: tradeEv.evidenceId,
        });
      }
      if (freshNet !== undefined && flowEv) {
        observations.push({
          claim: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (smNet !== undefined && flowEv) {
        observations.push({
          claim: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
    } else if (isSellerQuestion) {
      if (topSeller && tradeEv) {
        const vol = topSeller.volume || topSeller.sold_volume_usd || 0;
        const addr = topSeller.address_label || topSeller.label || truncateAddress(topSeller.address || '');
        observations.push({
          claim: `Top seller: ${addr}${vol > 0 ? ' (' + formatFlowUsd(vol) + ')' : ''}`,
          evidenceId: tradeEv.evidenceId,
        });
      } else {
        observations.push({
          claim: 'Top net sellers: 0 prominent individual seller addresses flagged',
          evidenceId: tradeEv ? tradeEv.evidenceId : (flowEv ? flowEv.evidenceId : request.evidence[0].evidenceId),
        });
      }
      if (exNet !== undefined && flowEv) {
        observations.push({
          claim: `Exchanges: ${formatFlowUsd(Number(exNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (whaleNet !== undefined && flowEv) {
        observations.push({
          claim: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (smNet !== undefined && flowEv) {
        observations.push({
          claim: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
    } else if (isTxQuestion) {
      const rawTransfers = Array.isArray((txEv?.normalizedData as any)?.transfers)
        ? [...(txEv!.normalizedData as any).transfers]
        : Array.isArray((txEv?.rawPayload as any)?.transfers)
        ? [...(txEv!.rawPayload as any).transfers]
        : [];

      rawTransfers.sort((a, b) => {
        const valA = Number(a.amount_usd ?? a.amountUsd ?? a.transfer_value_usd ?? a.usd_value ?? 0);
        const valB = Number(b.amount_usd ?? b.amountUsd ?? b.transfer_value_usd ?? b.usd_value ?? 0);
        if (valB !== valA) return valB - valA;
        const amtA = Number(a.transfer_amount ?? a.amount ?? 0);
        const amtB = Number(b.transfer_amount ?? b.amount ?? 0);
        return amtB - amtA;
      });

      if (rawTransfers.length > 0) {
        rawTransfers.slice(0, 3).forEach((t, idx) => {
          const rank = idx === 0 ? 'Largest transfer' : idx === 1 ? '2nd largest transfer' : '3rd largest transfer';
          observations.push({
            claim: `${rank}: ${formatTransferItem(t, symbol)}`,
            evidenceId: txEv!.evidenceId,
          });
        });
      } else if (txEv) {
        observations.push({
          claim: `No large transfer transactions recorded above threshold for ${symbol} in the observed period`,
          evidenceId: txEv.evidenceId,
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
            claim: `Largest DEX trade: ${topTrade.action || topTrade.trade_type || 'Swap'}${valStr} on ${dex} (trader: ${trader})`,
            evidenceId: dexEv.evidenceId,
          });
        }
      }
      if (topBuyer && tradeEv && observations.length < 4) {
        const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        observations.push({
          claim: `Top trade accumulator: ${addr}`,
          evidenceId: tradeEv.evidenceId,
        });
      }
      if (freshNet !== undefined && flowEv && observations.length < 5) {
        observations.push({
          claim: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
    } else {
      // Default / "What's happening?" / "What changed recently?"
      if (freshNet !== undefined && flowEv) {
        observations.push({
          claim: `Fresh wallets: ${formatFlowUsd(Number(freshNet))} net flow`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (exNet !== undefined && flowEv) {
        observations.push({
          claim: `Exchanges: ${formatFlowUsd(Number(exNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (smNet !== undefined && flowEv) {
        observations.push({
          claim: `Smart Money / Top PnL: ${formatFlowUsd(Number(smNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (whaleNet !== undefined && flowEv) {
        observations.push({
          claim: `Whales: ${formatFlowUsd(Number(whaleNet))}`,
          evidenceId: flowEv.evidenceId,
        });
      }
      if (topBuyer && tradeEv && observations.length < 5) {
        const addr = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        observations.push({
          claim: `Top accumulator: ${addr}`,
          evidenceId: tradeEv.evidenceId,
        });
      }
    }

    // Fallback observations if none matched
    if (observations.length === 0 && request.evidence.length > 0) {
      for (const ev of request.evidence.slice(0, 3)) {
        observations.push({
          claim: ev.summary,
          evidenceId: ev.evidenceId,
        });
      }
    }

    const slicedObservations = observations.slice(0, 5);

    // 2. Formulate Direct Headline
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
      const rawTransfers = Array.isArray((txEv?.normalizedData as any)?.transfers)
        ? [...(txEv!.normalizedData as any).transfers]
        : Array.isArray((txEv?.rawPayload as any)?.transfers)
        ? [...(txEv!.rawPayload as any).transfers]
        : [];
      rawTransfers.sort((a, b) => {
        const valA = Number(a.amount_usd ?? a.amountUsd ?? a.transfer_value_usd ?? a.usd_value ?? 0);
        const valB = Number(b.amount_usd ?? b.amountUsd ?? b.transfer_value_usd ?? b.usd_value ?? 0);
        if (valB !== valA) return valB - valA;
        const amtA = Number(a.transfer_amount ?? a.amount ?? 0);
        const amtB = Number(b.transfer_amount ?? b.amount ?? 0);
        return amtB - amtA;
      });
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

    // 4. Map to findings
    const findings = [
      ...slicedObservations.map((obs) => ({
        id: generateId('fnd'),
        claim: obs.claim,
        status: 'OBSERVATION' as const,
        evidenceReferences: [{ evidenceId: obs.evidenceId, excerptOrMetric: obs.claim }],
        confidence: 1.0,
      })),
      {
        id: generateId('fnd'),
        claim: interpretation,
        status: 'INTERPRETATION' as const,
        evidenceReferences: request.evidence.map((e) => ({ evidenceId: e.evidenceId, excerptOrMetric: interpretation })),
        confidence: 0.85,
      },
    ];

    // 5. Compose answer markdown
    const lines: string[] = [headline, ''];
    for (const obs of slicedObservations) {
      lines.push(`• ${obs.claim}`);
    }
    lines.push('');
    lines.push(interpretation);
    if (evidenceCategories.length > 0) {
      lines.push('');
      lines.push('Evidence');
      for (const cat of evidenceCategories) {
        lines.push(`• ${cat}`);
      }
    }
    let unkStatement = 'Off-chain catalysts, private negotiations, and external news events';
    if (isWhaleQuestion) {
      unkStatement = 'Whether whale balance changes reflect profit-taking, portfolio rotation, or internal custody moves';
    } else if (isSellerQuestion) {
      unkStatement = 'Whether exchange flows reflect spot execution, collateral rebalancing, or custodial transfers';
    } else if (isBuyerQuestion) {
      unkStatement = 'Whether fresh-wallet buyers represent distinct individuals, institutional sub-accounts, or automated execution';
    } else if (isSmartMoneyQuestion) {
      unkStatement = 'Whether smart money flows represent directional positioning, arbitrage rebalancing, or passive hedging';
    } else if (isTxQuestion) {
      unkStatement = 'Specific off-chain counterparties or execution intent behind large transfers';
    } else if (isChangeQuestion) {
      unkStatement = 'Underlying market catalysts or off-chain events driving recent balance changes';
    }

    lines.push('');
    lines.push('Not Proven');
    lines.push(`• ${unkStatement}`);
    lines.push('');
    lines.push(`Ask another question about ${symbol}.`);
    const suggestions = deriveNextSuggestions(request.userQuestion, symbol);
    if (suggestions.length > 0) {
      lines.push(`Suggested: ${suggestions.map((q) => `"${q}"`).join(' • ')}`);
    }

    return {
      answerMarkdown: lines.join('\n'),
      headline,
      interpretation,
      evidenceCategories,
      findings,
      hypotheses: [
        {
          id: generateId('hyp'),
          statement: `Accumulation by top cohorts is supporting local liquidity.`,
          supportingFindingIds: findings.map((f) => f.id),
          counterFindingIds: [],
          confidence: 0.85,
        },
      ],
      openQuestions: [`Ask another question about ${symbol}.`],
    };
  }

  public async evaluateChallenge(request: LLMChallengeRequest): Promise<LLMChallengeResponse> {
    return {
      evaluationMarkdown: `Evaluated challenge against current evidence: "${request.userChallenge}". The on-chain record confirms data points while recognizing counter-arguments.`,
      concededPoints: ['Acknowledged alternative interpretation of transaction clustering.'],
      counterEvidencePoints: ['Retrieved transfer evidence remains verifiable on-chain.'],
      updatedFindings: request.currentFindings,
    };
  }
}
