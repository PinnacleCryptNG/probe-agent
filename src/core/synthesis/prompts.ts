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
      const normalizedSummary = JSON.stringify(item.normalizedData, null, 2);

      return [
        `[Evidence #${idx + 1}] ID: ${item.evidenceId}`,
        `Title: ${item.title}`,
        `Capability: ${prov.capability}`,
        `Chain: ${prov.chain.toUpperCase()}`,
        `Token: ${prov.tokenAddress}`,
        prov.relevantWallet ? `Relevant Wallet: ${prov.relevantWallet}` : '',
        prov.transactionHash ? `Transaction Hash: ${prov.transactionHash}` : '',
        `Summary: ${item.summary}`,
        `Normalized Data:\n${normalizedSummary}`,
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

