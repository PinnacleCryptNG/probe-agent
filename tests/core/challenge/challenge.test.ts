import { describe, expect, it } from 'vitest';
import { detectChallenge } from '../../../src/core/challenge/detector.js';
import { ChallengeSynthesizer, ChallengeSynthesisError } from '../../../src/core/challenge/synthesizer.js';
import { formatChallengeResult } from '../../../src/core/challenge/formatter.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { TokenContext } from '../../../src/types/domain.js';
import { EvidenceItem } from '../../../src/types/evidence.js';

describe('PROBE Challenge Mode (Phase 5)', () => {
  const TEST_INV_ID = 'inv_test_challenge_1';
  const OTHER_INV_ID = 'inv_other_456';

  const ethToken: TokenContext = {
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    resolvedAt: new Date().toISOString(),
  };

  const sampleEvidence: EvidenceItem[] = [
    {
      evidenceId: 'evi_flow_1',
      investigationId: TEST_INV_ID,
      turnKey: `${TEST_INV_ID}:turn_1`,
      provenance: {
        endpoint: '/api/v1/tgm/flow-intelligence',
        capability: 'flow_intelligence',
        fetchedAt: new Date().toISOString(),
        requestParams: { token_address: ethToken.address, chain: 'ethereum' },
        creditsCost: 1,
      },
      summary: 'Cohort Net Flows: ETHEREUM',
      normalizedData: {
        whalesNetUsd: -14810,
        freshWalletsNetUsd: 830130000,
        exchangesNetUsd: -349400000,
        smartMoneyNetUsd: -115730,
      },
      epistemicStatus: 'OBSERVATION',
    },
    {
      evidenceId: 'evi_trade_1',
      investigationId: TEST_INV_ID,
      turnKey: `${TEST_INV_ID}:turn_1`,
      provenance: {
        endpoint: '/api/v1/tgm/who-bought-sold',
        capability: 'who_bought_sold',
        fetchedAt: new Date().toISOString(),
        requestParams: { token_address: ethToken.address, chain: 'ethereum' },
        creditsCost: 1,
      },
      summary: 'Top Buyers and Sellers: ETHEREUM',
      normalizedData: {
        topBuyers: [
          {
            address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            address_label: 'Token Millionaire',
            volume: 242320000,
          },
        ],
        topSellers: [],
      },
      epistemicStatus: 'OBSERVATION',
    },
  ];

  const synthesizer = new ChallengeSynthesizer();

  // 1. Challenge Detection
  describe('1. Challenge Detection', () => {
    it('detects certainty challenges ("Are you sure?", "Is that actually proven?")', () => {
      const res1 = detectChallenge('Are you sure?');
      expect(res1.isChallenge).toBe(true);
      expect(res1.category).toBe('CERTAINTY');

      const res2 = detectChallenge('Is that actually proven?');
      expect(res2.isChallenge).toBe(true);
      expect(res2.category).toBe('CERTAINTY');

      const res3 = detectChallenge('Why do you think that?');
      expect(res3.isChallenge).toBe(true);
      expect(res3.category).toBe('CERTAINTY');
    });

    it('detects evidence challenges ("Prove it.", "What evidence supports that?")', () => {
      const res1 = detectChallenge('Prove it.');
      expect(res1.isChallenge).toBe(true);
      expect(res1.category).toBe('EVIDENCE_CHALLENGE');

      const res2 = detectChallenge('What evidence supports that?');
      expect(res2.isChallenge).toBe(true);
      expect(res2.category).toBe('EVIDENCE_CHALLENGE');

      const res3 = detectChallenge('Show me the evidence.');
      expect(res3.isChallenge).toBe(true);
      expect(res3.category).toBe('EVIDENCE_CHALLENGE');
    });

    it('detects alternative explanation challenges and extracts proposed hypotheses', () => {
      const res1 = detectChallenge('Could there be another explanation?');
      expect(res1.isChallenge).toBe(true);
      expect(res1.category).toBe('ALTERNATIVE_EXPLANATION');

      const res2 = detectChallenge('Could the whales just be moving funds between their own wallets?');
      expect(res2.isChallenge).toBe(true);
      expect(res2.category).toBe('ALTERNATIVE_EXPLANATION');
      expect(res2.specificHypothesis).toContain('moving funds');
    });

    it('detects contradiction challenges ("Is there evidence against this?")', () => {
      const res = detectChallenge('Is there evidence against this?');
      expect(res.isChallenge).toBe(true);
      expect(res.category).toBe('CONTRADICTION');
    });

    it('detects falsification challenges ("What would disprove it?")', () => {
      const res1 = detectChallenge('What would disprove it?');
      expect(res1.isChallenge).toBe(true);
      expect(res1.category).toBe('FALSIFICATION');

      const res2 = detectChallenge('What would actually confirm selling?');
      expect(res2.isChallenge).toBe(true);
      expect(res2.category).toBe('FALSIFICATION');
    });

    it('does not falsely trigger on normal follow-up questions', () => {
      expect(detectChallenge('What about smart money?').isChallenge).toBe(false);
      expect(detectChallenge('Who is buying?').isChallenge).toBe(false);
      expect(detectChallenge('Are whales accumulating?').isChallenge).toBe(false);
      expect(detectChallenge("What's happening?").isChallenge).toBe(false);
    });
  });

  // 2. Evidence Challenge
  describe('2. Evidence Challenge Synthesis', () => {
    it('returns exact observations supporting the finding with evidence references', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'What evidence supports that?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'EVIDENCE_CHALLENGE',
      });

      expect(result.verdict).toBe('partially_supported');
      expect(result.supportingEvidence.length).toBeGreaterThan(0);
      expect(result.supportingEvidence[0].statement).toContain('-$14.81K');
      expect(result.supportingEvidence[0].evidenceRefs).toContain('evi_flow_1');
      expect(result.whatIsNotProven).toContain('Whether the movement represents selling');
    });
  });

  // 3. Alternative Explanation Challenge
  describe('3. Alternative Explanation Challenge', () => {
    it('returns plausible alternatives and addresses user hypothesis without speculation', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Could the whales just be moving funds between their own wallets?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'ALTERNATIVE_EXPLANATION',
        specificHypothesis: 'internal wallet movement',
      });

      expect(result.verdict).toBe('partially_supported');
      expect(result.alternativeExplanations.some((a) => a.statement.toLowerCase().includes('internal'))).toBe(true);
      expect(result.conclusion).toContain('Yes. The available evidence establishes a net balance change');
      expect(result.conclusion).toContain('does not establish whether the movement represents selling');
    });
  });

  // 4. Contradiction Challenge
  describe('4. Contradiction Challenge', () => {
    it('reports when no contradictory evidence is found without claiming intent is proven', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Is there evidence against this?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CONTRADICTION',
      });

      expect(result.contradictingEvidence.length).toBeGreaterThan(0);
      expect(result.contradictingEvidence[0].statement).toContain('No contradictory evidence was found');
      expect(result.conclusion).toContain('absence of contradiction alone does not prove underlying motive');
    });
  });

  // 5. Certainty Challenge
  describe('5. Certainty Challenge', () => {
    it('distinguishes empirically established figures from unproven intent', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Are you sure?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CERTAINTY',
      });

      expect(result.verdict).toBe('partially_supported');
      expect(result.conclusion).toContain('empirically verified');
      expect(result.conclusion).toContain('remain unproven');
      expect(result.whatIsNotProven.length).toBeGreaterThan(0);
    });
  });

  // 6. Falsification Challenge
  describe('6. Falsification Challenge', () => {
    it('describes what would change conclusion without fabricating evidence', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'What would disprove it?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'FALSIFICATION',
      });

      expect(result.whatWouldChangeConclusion.length).toBeGreaterThan(0);
      expect(result.whatWouldChangeConclusion.some((w) => w.includes('Wallet-level transaction analysis'))).toBe(true);
      expect(result.conclusion).toContain('The conclusion would change if transaction-level traces reveal');
    });
  });

  // 7. Insufficient Evidence
  describe('7. Insufficient Evidence Handling', () => {
    it('returns insufficient_evidence verdict when no evidence items exist', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Prove it.',
        tokenContext: ethToken,
        evidence: [], // Empty!
        originalFinding: 'Some ungrounded claim',
      });

      expect(result.verdict).toBe('insufficient_evidence');
      expect(result.supportingEvidence).toHaveLength(0);
      expect(result.conclusion).toContain('Insufficient on-chain evidence exists');
    });
  });

  // 8. Cross-Investigation Evidence Rejection
  describe('8. Cross-Investigation Evidence Rejection', () => {
    it('rejects evidence belonging to another investigation', () => {
      const foreignEvidence: EvidenceItem = {
        evidenceId: 'evi_foreign',
        investigationId: OTHER_INV_ID, // Foreign ID!
        turnKey: `${OTHER_INV_ID}:turn_1`,
        provenance: {
          endpoint: '/api/v1/tgm/flow-intelligence',
          capability: 'flow_intelligence',
          fetchedAt: new Date().toISOString(),
          requestParams: {},
          creditsCost: 1,
        },
        summary: 'Foreign evidence',
        normalizedData: {},
        epistemicStatus: 'OBSERVATION',
      };

      expect(() =>
        synthesizer.synthesizeChallenge({
          investigationId: TEST_INV_ID,
          question: 'Prove it.',
          tokenContext: ethToken,
          evidence: [foreignEvidence],
          originalFinding: 'Whales are dumping',
        })
      ).toThrow(ChallengeSynthesisError);
    });
  });

  // 9. Hallucinated Evidence Reference Rejection
  describe('9. Hallucinated Evidence Reference Rejection', () => {
    it('rejects hallucinated evidence references not present in supplied evidence', () => {
      // Create a corrupted synthesizer or test validation
      expect(() => {
        (synthesizer as any).validateChallengeResult(
          {
            verdict: 'supported',
            originalFinding: 'Whale flow',
            supportingEvidence: [
              {
                statement: 'Whales moved funds',
                evidenceRefs: ['evi_fabricated_id'], // Fabricated!
              },
            ],
            contradictingEvidence: [],
            alternativeExplanations: [],
            whatIsNotProven: [],
            whatWouldChangeConclusion: [],
            conclusion: 'Done',
          },
          sampleEvidence
        );
      }).toThrow('HALLUCINATED_EVIDENCE_REFERENCE');
    });
  });

  // 10. Hallucinated Wallet Address Rejection
  describe('10. Hallucinated Wallet Address Rejection', () => {
    it('rejects hallucinated wallet addresses not present in evidence or token', () => {
      expect(() => {
        (synthesizer as any).validateChallengeResult(
          {
            verdict: 'supported',
            originalFinding: 'Whale flow',
            supportingEvidence: [
              {
                statement: 'Wallet 0x1111111111111111111111111111111111111111 dumped 50k ETH',
                evidenceRefs: ['evi_flow_1'],
              },
            ],
            contradictingEvidence: [],
            alternativeExplanations: [],
            whatIsNotProven: [],
            whatWouldChangeConclusion: [],
            conclusion: 'Done',
          },
          sampleEvidence,
          ethToken.address
        );
      }).toThrow('HALLUCINATED_WALLET_ADDRESS');
    });
  });

  // 11. Hallucinated Transaction Hash Rejection
  describe('11. Hallucinated Transaction Hash Rejection', () => {
    it('rejects hallucinated transaction hashes in challenge output', () => {
      expect(() => {
        (synthesizer as any).validateChallengeResult(
          {
            verdict: 'supported',
            originalFinding: 'Whale flow',
            supportingEvidence: [
              {
                statement: 'Tx 0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef sold tokens',
                evidenceRefs: ['evi_flow_1'],
              },
            ],
            contradictingEvidence: [],
            alternativeExplanations: [],
            whatIsNotProven: [],
            whatWouldChangeConclusion: [],
            conclusion: 'Done',
          },
          sampleEvidence,
          ethToken.address
        );
      }).toThrow('HALLUCINATED_TRANSACTION_HASH');
    });
  });

  // 12. Telegram Formatter Layout
  describe('12. Telegram Formatter Layout', () => {
    it('formats a ChallengeResult cleanly matching the specified structure', () => {
      const challengeResult = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Are you sure?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CERTAINTY',
      });

      const formatted = formatChallengeResult(challengeResult, ethToken.symbol);

      expect(formatted).toContain('🔎 Challenge — ETH');
      expect(formatted).toContain('Original finding');
      expect(formatted).toContain('Tracked whale wallets showed minimal net balance change of -$14.81K.');
      expect(formatted).toContain('Why it is supported');
      expect(formatted).toContain('• Nansen tracked whale cohort flow: -$14.81K');
      expect(formatted).toContain('What is NOT proven');
      expect(formatted).toContain('Alternative explanations');
      expect(formatted).toContain('Verdict');
      expect(formatted).toContain('PARTIALLY SUPPORTED');
      expect(formatted).toContain('What would change this');
    });
  });

  // 13. End-to-End Orchestrator Challenge Reuse & Zero Credits
  describe('13. End-to-End Orchestrator Challenge Reuse & Zero Credits', () => {
    it('reuses existing evidence, consumes 0 credits, and preserves session context', async () => {
      const manager = new InvestigationManager();
      const mockExecutor = {
        executeMany: async () => [],
      } as any;
      const mockPlanner = {
        plan: async () => ({
          planId: 'plan_1',
          intent: 'accumulation',
          plannedCapabilities: [],
          evidenceRequirements: [],
          estimatedCost: 0,
          unresolvedRequirements: [],
          warnings: [],
        }),
        toExecutableRequirements: () => [],
      } as any;
      const mockSynth = {
        synthesize: async () => ({
          success: true,
          answer: 'Whales net flow -$14.81K',
          headline: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: [],
          evidenceCategories: [],
          followUpQuestions: [],
          validated: true,
          investigationId: TEST_INV_ID,
          createdAt: new Date().toISOString(),
        }),
      } as any;

      const orchestrator = new InvestigationOrchestrator({
        planner: mockPlanner,
        executor: mockExecutor,
        synthesizer: mockSynth,
        investigationManager: manager,
      });

      // Initialize investigation with pre-existing evidence
      const inv = manager.createInvestigation({
        telegramChatId: 12345,
        token: ethToken,
        initialQuestion: 'Are whales accumulating?',
      });

      for (const ev of sampleEvidence) {
        manager.addEvidence(inv.id, { ...ev, investigationId: inv.id });
      }
      manager.addFinding(inv.id, {
        id: 'fnd_whale',
        claim: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        status: 'OBSERVATION',
        evidenceReferences: [{ evidenceId: 'evi_flow_1', excerptOrMetric: '-$14.81K' }],
        confidence: 1.0,
      });

      // User challenges: "Prove it."
      const turnResult = await orchestrator.executeTurn({
        investigationId: inv.id,
        chatId: 12345,
        question: 'Prove it.',
      });

      expect(turnResult.status).toBe('completed');
      expect(turnResult.challenge).toBeDefined();
      expect(turnResult.challenge?.verdict).toBe('partially_supported');
      expect(turnResult.challenge?.supportingEvidence[0].statement).toContain('-$14.81K');
      expect(turnResult.evidence.length).toBe(sampleEvidence.length); // Reused!
    });
  });

  // 14. Natural follow-up after challenge preserving token context
  describe('14. Natural follow-up after challenge preserving token context', () => {
    it('maintains active token context across follow-up queries without repeating token name', async () => {
      const manager = new InvestigationManager();
      const mockExecutor = {
        executeMany: async () => [],
      } as any;
      const mockPlanner = {
        plan: async (_ctx: any, q: string) => ({
          planId: 'plan_2',
          question: q,
          intent: 'smart_money',
          plannedCapabilities: ['flow_intelligence'],
          evidenceRequirements: [],
          estimatedCost: 0,
          unresolvedRequirements: [],
          warnings: [],
          tokenContext: ethToken,
        }),
        toExecutableRequirements: () => [],
      } as any;
      const mockSynth = {
        synthesize: async (req: any) => ({
          success: true,
          answer: `Smart money net flow for ${req.tokenContext.symbol}`,
          headline: `Smart money net flow for ${req.tokenContext.symbol}`,
          observations: [],
          interpretations: [],
          hypotheses: [],
          unknowns: [],
          evidenceRefs: [],
          evidenceCategories: [],
          followUpQuestions: [],
          validated: true,
          investigationId: TEST_INV_ID,
          createdAt: new Date().toISOString(),
        }),
      } as any;

      const orchestrator = new InvestigationOrchestrator({
        planner: mockPlanner,
        executor: mockExecutor,
        synthesizer: mockSynth,
        investigationManager: manager,
      });

      // 1. Initial investigation
      const inv = manager.createInvestigation({
        telegramChatId: 777,
        token: ethToken,
        initialQuestion: 'Are whales accumulating?',
      });
      for (const ev of sampleEvidence) {
        manager.addEvidence(inv.id, { ...ev, investigationId: inv.id });
      }

      // 2. Challenge: "Prove it."
      await orchestrator.executeTurn({
        chatId: 777,
        question: 'Prove it.',
      });

      // 3. Follow-up without specifying token: "What about smart money?"
      const followUpResult = await orchestrator.executeTurn({
        chatId: 777,
        question: 'What about smart money?',
      });

      expect(followUpResult.investigationId).toBe(inv.id);
      expect(followUpResult.token?.symbol).toBe('ETH');
      expect(followUpResult.question).toBe('What about smart money?');
    });
  });

  // ==========================================
  // PHASE 5B QUALITY HARDENING TESTS
  // ==========================================
  describe('Phase 5B Quality Hardening', () => {
    // 15. Evidence status independently supported
    it('reports evidence status as independently SUPPORTED when empirical data exists', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Are you sure?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CERTAINTY',
      });

      expect(result.evidenceStatus).toBe('SUPPORTED');
      expect(result.supportingEvidence.length).toBeGreaterThan(0);
      expect(result.supportingEvidence[0].statement).toContain('-$14.81K');
    });

    // 16. Interpretation status partially supported
    it('reports interpretation status as PARTIALLY_SUPPORTED when motive/causality is unproven', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Are you sure?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CERTAINTY',
      });

      expect(result.interpretationStatus).toBe('PARTIALLY_SUPPORTED');
      expect(result.whatIsNotProven.some((w) => w.includes('selling') || w.includes('intent'))).toBe(true);
    });

    // 17. Supported observation + uncertain interpretation in Telegram format
    it('separates Evidence status from Interpretation status in formatted output', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Are you sure?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'CERTAINTY',
      });

      const formatted = formatChallengeResult(result, ethToken.symbol);
      expect(formatted).toContain('Evidence\nSUPPORTED');
      expect(formatted).toContain('Interpretation\nPARTIALLY SUPPORTED');
      expect(formatted).toContain('• The balance reduction is observed.');
      expect(formatted).toContain('• The reason for it is not established.');
    });

    // 18. Falsification criteria discriminate between competing explanations
    it('discriminates between competing explanations in falsification challenges', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'What would actually confirm selling?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Tracked whale wallets showed minimal net balance change of -$14.81K.',
        category: 'FALSIFICATION',
      });

      expect(result.discriminatingCriteria).toBeDefined();
      expect(result.discriminatingCriteria!.length).toBeGreaterThanOrEqual(3);

      const sellingCrit = result.discriminatingCriteria!.find((d) => d.explanation.includes('selling'));
      expect(sellingCrit).toBeDefined();
      expect(sellingCrit!.criteria.some((c) => c.includes('exchange address'))).toBe(true);

      const internalCrit = result.discriminatingCriteria!.find((d) => d.explanation.includes('internal movement'));
      expect(internalCrit).toBeDefined();
      expect(internalCrit!.criteria.some((c) => c.includes('related or self-controlled wallet'))).toBe(true);

      const formatted = formatChallengeResult(result, ethToken.symbol);
      expect(formatted).toContain('Potential confirming evidence for selling');
      expect(formatted).toContain('Potential evidence for internal movement');
    });

    // 19. User-proposed alternative is explicitly addressed
    it('explicitly addresses user-proposed alternative hypotheses with dedicated structure', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'Could the whale activity just be internal wallet movement?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Whales: -$138.00K net flow',
        category: 'ALTERNATIVE_EXPLANATION',
        specificHypothesis: 'internal wallet movement',
      });

      expect(result.proposedAlternative).toBe('Internal wallet movement');
      expect(result.whatEvidenceEstablishes).toBeDefined();
      expect(result.whatEvidenceEstablishes![0]).toContain('Tracked whale balances decreased');
      expect(result.whatIsNotProven[0]).toContain('Whether the destination was controlled by the same entity');

      const formatted = formatChallengeResult(result, 'BONK');
      expect(formatted).toContain('Proposed alternative\nInternal wallet movement');
      expect(formatted).toContain('What the evidence establishes\n• Tracked whale balances decreased.');
      expect(formatted).toContain('What it does NOT establish\n• Whether the destination was controlled by the same entity.');
      expect(formatted).toContain('What would test the hypothesis\n• Wallet-level transaction analysis');
    });

    // 20. No claim that currently unavailable evidence exists (strictly conditional language)
    it('uses strictly conditional evidence criteria without claiming uncollected evidence exists', () => {
      const result = synthesizer.synthesizeChallenge({
        investigationId: TEST_INV_ID,
        question: 'What would disprove this?',
        tokenContext: ethToken,
        evidence: sampleEvidence,
        originalFinding: 'Whales: -$14.81K net flow',
        category: 'FALSIFICATION',
      });

      for (const dc of result.discriminatingCriteria || []) {
        for (const criterion of dc.criteria) {
          expect(criterion).toMatch(/would (?:support|provide|indicate)/i);
          expect(criterion).not.toMatch(/this proves/i);
        }
      }
    });

    // 21. No fabricated transaction/wallet evidence in Phase 5B fields
    it('rejects hallucinated wallets or tx hashes placed into Phase 5B discrimination fields', () => {
      expect(() => {
        (synthesizer as any).validateChallengeResult(
          {
            verdict: 'partially_supported',
            evidenceStatus: 'SUPPORTED',
            interpretationStatus: 'PARTIALLY_SUPPORTED',
            originalFinding: 'Whale flow',
            supportingEvidence: [
              {
                statement: 'Nansen tracked flow',
                evidenceRefs: ['evi_flow_1'],
              },
            ],
            contradictingEvidence: [],
            alternativeExplanations: [],
            whatIsNotProven: [],
            whatWouldChangeConclusion: [],
            conclusion: 'Done',
            proposedAlternative: 'Transfer to 0x9999999999999999999999999999999999999999', // Hallucinated!
          },
          sampleEvidence,
          ethToken.address
        );
      }).toThrow('HALLUCINATED_WALLET_ADDRESS');
    });
  });
});
