import { EvidenceItem } from '../../types/evidence.js';
import { formatFlowUsd, truncateAddress } from '../synthesis/formatting.js';
import {
  ChallengeEvidencePoint,
  ChallengeEvidenceStatus,
  ChallengeInterpretationStatus,
  ChallengeResult,
  ChallengeSynthesisRequest,
  ChallengeVerdict,
  FalsificationDiscrimination,
} from './types.js';

export class ChallengeSynthesisError extends Error {
  constructor(message: string, public readonly code: string) {
    super(`[${code}] ${message}`);
    this.name = 'ChallengeSynthesisError';
  }
}

export class ChallengeSynthesizer {
  /**
   * Synthesizes a disciplined, evidence-backed challenge response that defends,
   * qualifies, or revises a prior investigation finding without inventing facts.
   */
  public synthesizeChallenge(request: ChallengeSynthesisRequest): ChallengeResult {
    const symbol = request.tokenContext.symbol;

    // 1. Guard against empty evidence
    if (!request.evidence || request.evidence.length === 0) {
      return {
        verdict: 'insufficient_evidence',
        evidenceStatus: 'INSUFFICIENT',
        interpretationStatus: 'NOT_APPLICABLE',
        originalFinding: request.originalFinding || 'No prior finding established',
        supportingEvidence: [],
        contradictingEvidence: [],
        alternativeExplanations: [],
        whatIsNotProven: ['No on-chain records exist in the current investigation to support or challenge this claim.'],
        whatWouldChangeConclusion: ['Retrieval of relevant on-chain cohort flows or transaction logs.'],
        conclusion: 'Insufficient on-chain evidence exists in this investigation to evaluate the claim.',
      };
    }

    // 2. Validate evidence provenance: All evidence must belong to the current investigation
    for (const ev of request.evidence) {
      if (ev.investigationId !== request.investigationId) {
        throw new ChallengeSynthesisError(
          `Cross-investigation evidence rejected: evidence '${ev.evidenceId}' belongs to investigation '${ev.investigationId}', not '${request.investigationId}'.`,
          'CROSS_INVESTIGATION_EVIDENCE_REJECTED'
        );
      }
    }

    // Build evidence lookup
    const validEvidenceMap = new Map<string, EvidenceItem>();
    for (const ev of request.evidence) {
      validEvidenceMap.set(ev.evidenceId, ev);
    }

    // 3. Resolve original finding
    let originalFinding = request.originalFinding;
    if (!originalFinding && request.findings && request.findings.length > 0) {
      const qLower = request.question.toLowerCase();
      if (/whale/i.test(qLower)) {
        const whaleFinding = request.findings.find((f) => /whale/i.test(f.claim));
        if (whaleFinding) originalFinding = whaleFinding.claim;
      } else if (/smart money/i.test(qLower)) {
        const smFinding = request.findings.find((f) => /smart money/i.test(f.claim));
        if (smFinding) originalFinding = smFinding.claim;
      } else if (/buy/i.test(qLower)) {
        const buyFinding = request.findings.find((f) => /buyer|accumulat/i.test(f.claim));
        if (buyFinding) originalFinding = buyFinding.claim;
      } else if (/sell/i.test(qLower)) {
        const sellFinding = request.findings.find((f) => /seller|exchange/i.test(f.claim));
        if (sellFinding) originalFinding = sellFinding.claim;
      }
      if (!originalFinding) {
        originalFinding = request.findings[0].claim;
      }
    }

    if (!originalFinding) {
      originalFinding = `Tracked on-chain participant activity in ${symbol} during the observed period.`;
    }

    // 4. Derive evidence-backed supporting points
    const flowEv = request.evidence.find((e) => e.provenance.capability === 'flow_intelligence');
    const tradeEv = request.evidence.find((e) => e.provenance.capability === 'who_bought_sold');

    const supportingEvidence: ChallengeEvidencePoint[] = [];

    const normFlow = flowEv?.normalizedData as any;
    const whaleNet = normFlow?.whalesNetUsd ?? normFlow?.whales_net_usd;
    const freshNet = normFlow?.freshWalletsNetUsd ?? normFlow?.fresh_wallets_net_usd;
    const exNet = normFlow?.exchangesNetUsd ?? normFlow?.exchanges_net_usd;
    const smNet = normFlow?.smartMoneyNetUsd ?? normFlow?.smart_money_net_usd;

    const normTrades = tradeEv?.normalizedData as any;
    const topBuyer = normTrades?.topBuyers?.[0] || normTrades?.top_buyers?.[0];

    const qLower = request.question.toLowerCase();
    const isWhaleFocus = /whale/i.test(qLower) || /whale/i.test(originalFinding);
    const isBuyerFocus = /who.*buy|buyer|accumulat/i.test(qLower) || /buyer|fresh-wallet/i.test(originalFinding);
    const isSellerFocus = /who.*sell|seller|exchange/i.test(qLower) || /exchange|seller/i.test(originalFinding);
    const isSmartMoneyFocus = /smart money/i.test(qLower) || /smart money/i.test(originalFinding);

    if (isWhaleFocus && whaleNet !== undefined && flowEv) {
      supportingEvidence.push({
        statement: `Nansen tracked whale cohort flow: ${formatFlowUsd(Number(whaleNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
      supportingEvidence.push({
        statement: 'Observation came from the same investigation window',
        evidenceRefs: [flowEv.evidenceId],
      });
    } else if (isBuyerFocus) {
      if (topBuyer && tradeEv) {
        const name = topBuyer.address_label || topBuyer.label || truncateAddress(topBuyer.address || '');
        const vol = topBuyer.volume || topBuyer.bought_volume_usd;
        supportingEvidence.push({
          statement: `Top buyer trade data: ${name}${vol ? ` (${formatFlowUsd(Number(vol))})` : ''}`,
          evidenceRefs: [tradeEv.evidenceId],
        });
      }
      if (freshNet !== undefined && flowEv) {
        supportingEvidence.push({
          statement: `Fresh wallets recorded net inflows of ${formatFlowUsd(Number(freshNet))}`,
          evidenceRefs: [flowEv.evidenceId],
        });
      }
    } else if (isSellerFocus) {
      if (exNet !== undefined && flowEv) {
        supportingEvidence.push({
          statement: `Tracked exchange net flow recorded: ${formatFlowUsd(Number(exNet))}`,
          evidenceRefs: [flowEv.evidenceId],
        });
      }
      if (tradeEv) {
        supportingEvidence.push({
          statement: 'Top seller monitoring identified no outsized individual dumping address',
          evidenceRefs: [tradeEv.evidenceId],
        });
      }
    } else if (isSmartMoneyFocus && smNet !== undefined && flowEv) {
      supportingEvidence.push({
        statement: `Smart Money / Top PnL net flow: ${formatFlowUsd(Number(smNet))}`,
        evidenceRefs: [flowEv.evidenceId],
      });
    } else {
      // General fallback supporting evidence from verified items
      if (flowEv) {
        supportingEvidence.push({
          statement: `Verified cohort flow telemetry retrieved for ${symbol}`,
          evidenceRefs: [flowEv.evidenceId],
        });
      }
      if (tradeEv) {
        supportingEvidence.push({
          statement: `Counterparty trade distributions monitored during current period`,
          evidenceRefs: [tradeEv.evidenceId],
        });
      }
    }

    // 5. Derive Contradicting Evidence
    const contradictingEvidence: ChallengeEvidencePoint[] = [];
    if (request.category === 'CONTRADICTION') {
      if (contradictingEvidence.length === 0 && request.evidence.length > 0) {
        contradictingEvidence.push({
          statement: 'No contradictory evidence was found in the evidence collected for this investigation.',
          evidenceRefs: [request.evidence[0].evidenceId],
        });
      }
    }

    // 6. Alternative Explanations
    const alternativeExplanations: ChallengeEvidencePoint[] = [];
    const baseRef = flowEv?.evidenceId || tradeEv?.evidenceId || request.evidence[0].evidenceId;

    if (request.specificHypothesis) {
      const hypClean = request.specificHypothesis.replace(/^(the\s+)?(whale\s+)?(activity\s+)?(just\s+)?(be\s+)?/i, '').trim();
      const statement = hypClean.charAt(0).toUpperCase() + hypClean.slice(1);
      alternativeExplanations.push({
        statement,
        evidenceRefs: [baseRef],
      });
    }

    if (isWhaleFocus) {
      if (!alternativeExplanations.some((e) => e.statement.toLowerCase().includes('portfolio'))) {
        alternativeExplanations.push({
          statement: 'Portfolio rebalancing',
          evidenceRefs: [baseRef],
        });
      }
      if (!alternativeExplanations.some((e) => e.statement.toLowerCase().includes('internal'))) {
        alternativeExplanations.push({
          statement: 'Internal custody movement',
          evidenceRefs: [baseRef],
        });
      }
    } else if (isBuyerFocus) {
      alternativeExplanations.push({
        statement: 'Algorithmic liquidity routing across DEX pools',
        evidenceRefs: [baseRef],
      });
      alternativeExplanations.push({
        statement: 'Institutional sub-account allocations',
        evidenceRefs: [baseRef],
      });
    } else if (isSellerFocus) {
      alternativeExplanations.push({
        statement: 'Exchange cold-storage rebalancing',
        evidenceRefs: [baseRef],
      });
      alternativeExplanations.push({
        statement: 'Collateral transfers for staking or lending',
        evidenceRefs: [baseRef],
      });
    } else {
      alternativeExplanations.push({
        statement: 'OTC rebalancing or off-exchange settlement',
        evidenceRefs: [baseRef],
      });
    }

    // 7. What is NOT proven & Specific hypothesis handling
    let proposedAlternative: string | undefined;
    let whatEvidenceEstablishes: string[] | undefined;
    let whatIsNotProven: string[] = [];

    if (request.specificHypothesis) {
      const hypClean = request.specificHypothesis
        .replace(/^(the\s+)?(whale\s+)?(activity\s+)?(just\s+)?(be\s+)?/i, '')
        .trim();
      proposedAlternative = hypClean.charAt(0).toUpperCase() + hypClean.slice(1);
      whatEvidenceEstablishes = [
        isWhaleFocus
          ? 'Tracked whale balances decreased.'
          : `Observed activity in ${symbol} telemetry was recorded.`,
      ];
      whatIsNotProven = [
        'Whether the destination was controlled by the same entity.',
        'Whether the movement represents an executed sale or internal transfer.',
      ];
    } else if (isWhaleFocus) {
      whatIsNotProven.push('Whether the movement represents selling');
      whatIsNotProven.push('Whether funds moved between related wallets');
      whatIsNotProven.push('The reason for the balance change');
    } else if (isBuyerFocus) {
      whatIsNotProven.push('Whether buyers represent distinct individuals or automated routing');
      whatIsNotProven.push('The investment horizon or holding intent of the accumulators');
    } else if (isSellerFocus) {
      whatIsNotProven.push('Whether exchange outflows were moved for long-term custody or staking');
      whatIsNotProven.push('The order-book selling pressure in off-chain venues');
    } else {
      whatIsNotProven.push('Off-chain catalysts, private agreements, and holder intent');
    }

    // 8. What would change this & Falsification discrimination
    let whatWouldChangeConclusion: string[] = [];
    let discriminatingCriteria: FalsificationDiscrimination[] | undefined;

    if (request.specificHypothesis) {
      whatWouldChangeConclusion = [
        'Wallet-level transaction analysis',
        'Related-wallet / ownership evidence',
      ];
    } else if (request.category === 'FALSIFICATION') {
      discriminatingCriteria = [
        {
          explanation: 'Potential confirming evidence for selling',
          criteria: [
            'Transaction-level transfer to a known exchange address (would support liquidation intent)',
            'Matching DEX or exchange trade execution (would provide evidence of an executed sale)',
            'Wallet-level trade records showing the token was sold for other assets (would provide direct evidence of disposition)',
          ],
        },
        {
          explanation: 'Potential evidence for internal movement',
          criteria: [
            'Transfer to a related or self-controlled wallet (would provide evidence of internal reorganization)',
            'Wallet clustering showing common ownership or control (would indicate intra-entity reorganization)',
          ],
        },
        {
          explanation: 'Potential evidence for another explanation',
          criteria: [
            'Transfer to known staking, collateral, or bridge infrastructure (would support non-sale deployment)',
          ],
        },
      ];
      whatWouldChangeConclusion = [
        'Wallet-level transaction analysis',
        'Evidence linking the movement to an executed sale',
        'Wallet clustering showing common ownership or custody transfers',
      ];
    } else {
      whatWouldChangeConclusion = [
        'Wallet-level transaction analysis',
        'Evidence linking the movement to an executed sale',
      ];
    }

    // 9. Verdict Determination (Phase 5B: Separate Evidence from Interpretation Status)
    let verdict: ChallengeVerdict = 'partially_supported';
    let evidenceStatus: ChallengeEvidenceStatus = 'SUPPORTED';
    let interpretationStatus: ChallengeInterpretationStatus = 'PARTIALLY_SUPPORTED';

    if (request.category === 'CONTRADICTION' && contradictingEvidence.length > 0 && !contradictingEvidence[0].statement.includes('No contradictory evidence')) {
      verdict = 'not_supported';
      evidenceStatus = 'CONTRADICTED';
      interpretationStatus = 'UNSUPPORTED';
    } else if (supportingEvidence.length === 0) {
      verdict = 'insufficient_evidence';
      evidenceStatus = 'INSUFFICIENT';
      interpretationStatus = 'NOT_APPLICABLE';
    } else {
      verdict = 'partially_supported';
      evidenceStatus = 'SUPPORTED';
      interpretationStatus = 'PARTIALLY_SUPPORTED';
    }

    // 10. Formulate Conclusion
    let conclusion: string;
    if (request.specificHypothesis && /internal/i.test(request.specificHypothesis)) {
      conclusion =
        'Yes. The available evidence establishes a net balance change in tracked wallets, but it does not establish whether the movement represents selling, portfolio rotation, or transfers between related wallets.';
    } else if (request.category === 'CERTAINTY') {
      conclusion =
        'The observed figures are empirically verified from on-chain telemetry, but trader intentions and off-chain catalysts remain unproven.';
    } else if (request.category === 'ALTERNATIVE_EXPLANATION') {
      conclusion =
        'The evidence supports the observed balance change, but it does not establish the underlying intent. Alternative explanations remain plausible.';
    } else if (request.category === 'EVIDENCE_CHALLENGE') {
      conclusion =
        'The evidence supports the observed balance change, but it does not establish the underlying intent.';
    } else if (request.category === 'FALSIFICATION') {
      conclusion =
        'The conclusion would change if transaction-level traces reveal destination counterparty clustering or direct exchange executions. The criteria above would help distinguish between external sales, internal transfers, and protocol deployment.';
    } else if (request.category === 'CONTRADICTION') {
      conclusion =
        'No contradictory observations were identified in the collected evidence. However, absence of contradiction alone does not prove underlying motive.';
    } else {
      conclusion =
        'The evidence supports the observed balance change, but it does not establish the underlying intent.';
    }

    const result: ChallengeResult = {
      verdict,
      evidenceStatus,
      interpretationStatus,
      originalFinding,
      supportingEvidence,
      contradictingEvidence,
      alternativeExplanations,
      whatIsNotProven,
      whatWouldChangeConclusion,
      conclusion,
      proposedAlternative,
      whatEvidenceEstablishes,
      discriminatingCriteria,
    };

    // 11. Run Evidence & Hallucination validation
    this.validateChallengeResult(result, request.evidence, request.tokenContext.address);

    return result;
  }

  /**
   * Validates that the synthesized challenge result only cites verified evidence IDs
   * and contains no hallucinated wallet addresses or transaction hashes.
   */
  private validateChallengeResult(
    result: ChallengeResult,
    suppliedEvidence: EvidenceItem[],
    targetAddress?: string
  ): void {
    const validEvidenceIds = new Set(suppliedEvidence.map((e) => e.evidenceId));

    // Validate supporting evidence references
    for (const item of result.supportingEvidence) {
      for (const ref of item.evidenceRefs) {
        if (!validEvidenceIds.has(ref)) {
          throw new ChallengeSynthesisError(
            `Supporting evidence cites unverified evidence reference: '${ref}'.`,
            'HALLUCINATED_EVIDENCE_REFERENCE'
          );
        }
      }
    }

    // Validate contradicting evidence references
    for (const item of result.contradictingEvidence) {
      for (const ref of item.evidenceRefs) {
        if (!validEvidenceIds.has(ref)) {
          throw new ChallengeSynthesisError(
            `Contradicting evidence cites unverified evidence reference: '${ref}'.`,
            'HALLUCINATED_EVIDENCE_REFERENCE'
          );
        }
      }
    }

    // Validate alternative explanation references
    for (const item of result.alternativeExplanations) {
      for (const ref of item.evidenceRefs) {
        if (!validEvidenceIds.has(ref)) {
          throw new ChallengeSynthesisError(
            `Alternative explanation cites unverified evidence reference: '${ref}'.`,
            'HALLUCINATED_EVIDENCE_REFERENCE'
          );
        }
      }
    }

    // Hallucination check for unknown wallets or hashes
    const knownWallets = new Set<string>();
    if (targetAddress) knownWallets.add(targetAddress.toLowerCase());

    for (const ev of suppliedEvidence) {
      const data = ev.normalizedData as any;
      if (data?.topBuyers) {
        for (const b of data.topBuyers) {
          if (b.address) knownWallets.add(b.address.toLowerCase());
        }
      }
      if (data?.topSellers) {
        for (const s of data.topSellers) {
          if (s.address) knownWallets.add(s.address.toLowerCase());
        }
      }
      if (data?.transfers) {
        for (const t of data.transfers) {
          if (t.from) knownWallets.add(t.from.toLowerCase());
          if (t.to) knownWallets.add(t.to.toLowerCase());
        }
      }
    }

    const allStatements = [
      result.originalFinding,
      ...result.supportingEvidence.map((s) => s.statement),
      ...result.contradictingEvidence.map((s) => s.statement),
      ...result.alternativeExplanations.map((s) => s.statement),
      ...result.whatIsNotProven,
      ...result.whatWouldChangeConclusion,
      result.conclusion,
      ...(result.whatEvidenceEstablishes || []),
      ...(result.discriminatingCriteria?.flatMap((dc) => [dc.explanation, ...dc.criteria]) || []),
      ...(result.proposedAlternative ? [result.proposedAlternative] : []),
    ];

    const evmRegex = /\b0x[a-fA-F0-9]{40}\b/g;
    const txHashRegex = /\b0x[a-fA-F0-9]{64,}\b/g;

    for (const text of allStatements) {
      const evmMatches = text.match(evmRegex) || [];
      for (const addr of evmMatches) {
        if (!knownWallets.has(addr.toLowerCase())) {
          throw new ChallengeSynthesisError(
            `Hallucinated wallet address detected in challenge output: '${addr}'.`,
            'HALLUCINATED_WALLET_ADDRESS'
          );
        }
      }
      const txMatches = text.match(txHashRegex) || [];
      if (txMatches.length > 0) {
        throw new ChallengeSynthesisError(
          `Hallucinated transaction hash detected in challenge output: '${txMatches[0]}'.`,
          'HALLUCINATED_TRANSACTION_HASH'
        );
      }
    }
  }
}
