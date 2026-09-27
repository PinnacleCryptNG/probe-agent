import { EvidenceItem } from '../../types/evidence.js';
import { SynthesisRequest } from './types.js';

export const SYNTHESIS_SYSTEM_PROMPT = `You are the lead on-chain cryptocurrency forensics investigator for PROBE.
PROBE is an investigation agent, not a database viewer.

NEW ANSWER PRINCIPLES:
1. Answer the question FIRST: Provide a 1-2 sentence direct headline answer. Do NOT lead with generic spot price or market cap metadata unless the user specifically asked about price.
2. Select 3–5 KEY OBSERVATIONS: Only include the most relevant observations for the user's question (e.g. cohort net flows, fresh wallets, exchange net flows, smart money, top buyers/sellers). Format each observation cleanly with verified metrics (e.g. "Fresh wallets: +$613.97M net flow", "Exchanges: +$61.27M", "Smart Money / Top PnL: +$36.57M", "Whales: $0").
3. INTERPRETATION: One short paragraph explaining what the observations indicate. Clearly distinguish observation from interpretation.
4. EVIDENCE: Short list of 2–4 human-readable evidence categories/references (e.g. "Cohort net flows", "Top buyer/seller data", "ETH/WETH token metrics").
5. OPTIONAL NEXT QUESTION: A simple, single-line invitation: "Ask another question about {SYMBOL}." Do NOT force the user into a follow-up questionnaire.

EPISTEMIC RULES:
- OBSERVATION: Directly supported by retrieved Nansen evidence. Every observation must cite its exact evidence ID (e.g., evi_...).
- INTERPRETATION: Reasonable analytical explanation of the observations.
- HYPOTHESIS: Possible explanation that requires additional evidence.
- UNKNOWN: Something the available evidence cannot establish.
- NEVER turn an interpretation into a fact.
- NEVER invent causality (e.g. do NOT say "ETH is pumping because whales are accumulating"). Instead say "Whale accumulation is not visible in the retrieved cohort data" or "The available data shows fresh-wallet inflows, but it does not establish why those wallets are moving ETH".
- NEVER invent wallet addresses, transaction hashes, or numbers.
- Do NOT expose internal capability names (e.g. flow_intelligence, who_bought_sold) or internal planner jargon.
- Do NOT use vague boilerplate like "localized activity across participating cohorts".

CONCISENESS & LENGTH:
- Keep the response concise, approximately 150–250 words maximum.
- The user must never receive a raw dump of API fields.`;

/**
 * Deterministically compacts normalized evidence data for LLM prompt context.
 * Strips raw records and trims redundant deep arrays while preserving all
 * metrics, addresses, flows, and counts required for grounded observations and citations.
 */
export function compactNormalizedData(
  data: Record<string, unknown>,
  capability?: string
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};

  if (capability === 'flow_intelligence') {
    return {
      smartMoneyNetUsd: data.smartMoneyNetUsd,
      topPnlNetUsd: data.topPnlNetUsd,
      whalesNetUsd: data.whalesNetUsd,
      freshWalletsNetUsd: data.freshWalletsNetUsd,
      exchangesNetUsd: data.exchangesNetUsd,
      publicFigureNetUsd: data.publicFigureNetUsd,
    };
  }

  if (capability === 'who_bought_sold') {
    const buyers = Array.isArray(data.buyers)
      ? data.buyers.slice(0, 5).map((b: any) => ({
          address: b.address,
          address_label: b.address_label || b.label,
          volume_usd: b.volume_usd,
        }))
      : [];
    const sellers = Array.isArray(data.sellers)
      ? data.sellers.slice(0, 5).map((s: any) => ({
          address: s.address,
          address_label: s.address_label || s.label,
          volume_usd: s.volume_usd,
        }))
      : [];
    return {
      topBuyers: buyers,
      topSellers: sellers,
      totalBuyersCount: data.totalBuyersCount ?? buyers.length,
      totalSellersCount: data.totalSellersCount ?? sellers.length,
    };
  }

  if (capability === 'token_information') {
    return {
      symbol: data.symbol,
      name: data.name,
      priceUsd: data.priceUsd,
      marketCapUsd: data.marketCapUsd,
      volume24hUsd: data.volume24hUsd,
      totalSupply: data.totalSupply,
      circulatingSupply: data.circulatingSupply,
    };
  }

  if (capability === 'token_holders') {
    const holders = Array.isArray(data.holders)
      ? data.holders.slice(0, 5).map((h: any) => ({
          address: h.address,
          label: h.label,
          percentage_held: h.percentage_held,
        }))
      : [];
    return {
      topHolders: holders,
      top10Percentage: data.top10Percentage,
      top50Percentage: data.top50Percentage,
      totalHoldersCount: data.count ?? holders.length,
    };
  }

  if (capability === 'historical_flows') {
    const flows = Array.isArray(data.flows) ? data.flows.slice(0, 7) : data.flows;
    return {
      recentFlows: flows,
      totalCount: data.count,
      trend_7d: data.trend_7d,
      primary_cohort: data.primary_cohort,
    };
  }

  if (capability === 'token_transfers') {
    const transfers = Array.isArray(data.transfers)
      ? data.transfers.slice(0, 5).map((t: any) => ({
          transaction_hash: t.transactionHash || t.transaction_hash || t.hash,
          timestamp: t.timestamp || t.block_timestamp,
          chain: t.chain,
          token_symbol: t.tokenSymbol || t.token_symbol || t.symbol,
          amount: t.amount,
          amount_usd: t.usdValue ?? t.amount_usd ?? t.transfer_value_usd,
          from_address: t.fromAddress || t.from_address || t.from,
          from_label: t.fromLabel || t.from_label,
          to_address: t.toAddress || t.to_address || t.to,
          to_label: t.toLabel || t.to_label,
          transaction_type: t.transactionType || t.transaction_type,
          ranked_by: t.rankedBy,
        }))
      : [];
    return {
      topTransfers: transfers,
      totalCount: data.count ?? transfers.length,
    };
  }

  if (capability === 'dex_trades') {
    const trades = Array.isArray(data.trades)
      ? data.trades.slice(0, 5).map((t: any) => ({
          transaction_hash: t.transaction_hash || t.hash,
          buyer_address: t.buyer_address || t.buyer,
          volume_usd: t.volume_usd,
        }))
      : [];
    return {
      recentTrades: trades,
      totalCount: data.count ?? trades.length,
    };
  }

  // Generic fallback: omit rawRecord / rawData and limit arrays to top 5
  const compacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'rawRecord' || k === 'rawData') continue;
    if (Array.isArray(v)) {
      compacted[k] = v.slice(0, 5);
      if (v.length > 5) {
        compacted[`${k}Count`] = v.length;
      }
    } else {
      compacted[k] = v;
    }
  }
  return compacted;
}

/**
 * Formats evidence items into a clean, sanitized text representation for LLM prompt context.
 * Strips any internal secrets, keys, or non-observational metadata.
 */
export function formatEvidenceForPrompt(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) {
    return 'NO ON-CHAIN EVIDENCE ITEMS RETRIEVED.';
  }

  return evidence
    .map((item, idx) => {
      const prov = item.provenance;
      const compactData = compactNormalizedData(item.normalizedData, prov.capability);
      const normalizedSummary = JSON.stringify(compactData);

      return [
        `[Evidence #${idx + 1}] ID: ${item.evidenceId}`,
        `Title: ${item.title}`,
        `Capability: ${prov.capability}`,
        `Chain: ${prov.chain.toUpperCase()}`,
        `Token: ${prov.tokenAddress}`,
        prov.relevantWallet ? `Relevant Wallet: ${prov.relevantWallet}` : '',
        prov.transactionHash ? `Transaction Hash: ${prov.transactionHash}` : '',
        `Summary: ${item.summary}`,
        `Evidence Metrics: ${normalizedSummary}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}

/**
 * Builds the user prompt incorporating question, token context, sanitized evidence, and plan context.
 */
export function buildSynthesisUserPrompt(request: SynthesisRequest): string {
  const symbol = request.tokenContext.symbol;
  const sections: string[] = [
    `# Target Token: ${request.tokenContext.name} (${symbol}) on ${request.tokenContext.chain.toUpperCase()}`,
    `Contract Address: ${request.tokenContext.address}`,
    `User Question: "${request.question}"`,
    '',
    '## Retrieved On-Chain Evidence',
    formatEvidenceForPrompt(request.evidence),
  ];

  if (request.plan) {
    sections.push(
      '',
      `## Investigation Intent: ${request.plan.intent}`,
      request.plan.unresolvedRequirements.length > 0
        ? `Unresolved Boundaries:\n${request.plan.unresolvedRequirements.map((u) => `- ${u}`).join('\n')}`
        : ''
    );
  }

  sections.push(
    '',
    '## Output Schema Instructions',
    'Respond ONLY with a valid JSON object matching this schema:',
    '{',
    '  "headline": "1-2 sentence direct answer to the user\'s question (do not lead with price unless asked)",',
    '  "observations": [',
    '    {',
    '      "claim": "Concise clean metric bullet (e.g. Fresh wallets: +$613.97M net flow)",',
    '      "evidenceId": "exact_evidence_id_from_above"',
    '    }',
    '  ],',
    '  "interpretation": "One short paragraph explaining what the observations indicate and noting epistemic limits",',
    '  "evidenceCategories": ["Cohort net flows", "Top buyer/seller data"],',
    '  "hypotheses": [',
    '    { "statement": "Optional possible explanation requiring additional evidence" }',
    '  ],',
    '  "unknowns": [',
    '    { "statement": "What the data cannot establish", "reason": "Reason" }',
    '  ]',
    '}'
  );

  return sections.join('\n');
}

