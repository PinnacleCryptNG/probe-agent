import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityName } from '../../../src/types/capabilities.js';
import { TokenContext } from '../../../src/types/domain.js';
import { EvidenceItem } from '../../../src/types/evidence.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { ExecutionResult } from '../../../src/core/evidence/types.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationPlan } from '../../../src/core/planner/types.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { SynthesisResult } from '../../../src/core/synthesis/types.js';

// TEST FIXTURE — NOT REAL BLOCKCHAIN DATA
const TEST_TOKEN: TokenContext = {
  address: '0x1234567890123456789012345678901234567890',
  symbol: 'PEPE',
  name: 'Pepe',
  chain: 'ethereum',
  decimals: 18,
  priceUsd: 0.00001,
  marketCapUsd: 4200000000,
  liquidityUsd: 50000000,
  resolvedAt: '2026-03-20T12:00:00.000Z',
};

// TEST FIXTURE — NOT REAL BLOCKCHAIN DATA
function createTestEvidence(id: string, capability: CapabilityName = 'token_information'): EvidenceItem {
  return {
    evidenceId: id,
    investigationId: 'inv_test_orchestrator',
    title: `TEST FIXTURE — NOT REAL BLOCKCHAIN DATA (${capability})`,
    summary: 'Spot net accumulation observed across cohort wallets',
    epistemicStatus: 'ESTABLISHED_FACT',
    confidenceScore: 1.0,
    confidenceReason: 'Verified deterministic test data',
    provenance: {
      source: 'nansen',
      endpoint: '/api/v1/test',
      capability,
      chain: 'ethereum',
      tokenAddress: TEST_TOKEN.address,
      extractedAt: '2026-03-20T12:00:00.000Z',
      creditsCost: 1,
    },
    rawPayload: { test: true },
    normalizedData: {
      address: TEST_TOKEN.address,
      symbol: TEST_TOKEN.symbol,
      netVolumeUsd: 500000,
    },
    createdAt: '2026-03-20T12:00:00.000Z',
  };
}

describe('InvestigationOrchestrator (Phase 2D)', () => {
  let manager: InvestigationManager;
  let plannerMock: InvestigationPlanner;
  let executorMock: EvidenceExecutor;
  let synthesizerMock: EvidenceSynthesisEngine;
  let orchestrator: InvestigationOrchestrator;

  beforeEach(() => {
    manager = new InvestigationManager();

    plannerMock = {
      plan: vi.fn().mockResolvedValue({
        planId: 'plan_test_1',
        question: 'Why is PEPE pumping?',
        intent: 'activity_change',
        evidenceRequirements: [
          {
            id: 'req_1',
            concept: 'current token price',
            priority: 'required',
            rationale: 'Baseline price',
            candidateCapabilities: ['token_information'],
            resolvedCapability: 'token_information',
            parameters: { token_address: TEST_TOKEN.address, chain: 'ethereum' },
          },
        ],
        selectedCapabilities: ['token_information'],
        plannedCapabilities: [
          {
            name: 'token_information',
            reason: 'Baseline price',
            estimatedCost: 1,
            priority: 'required',
            parameters: { token_address: TEST_TOKEN.address, chain: 'ethereum' },
          },
        ],
        estimatedCreditCost: 1,
        unresolvedRequirements: [],
        warnings: [],
        createdAt: '2026-03-20T12:00:00.000Z',
      } as InvestigationPlan),
      toExecutableRequirements: vi.fn().mockReturnValue([
        {
          id: 'req_1',
          capabilityName: 'token_information',
          reason: 'Baseline price',
          parameters: { token_address: TEST_TOKEN.address, chain: 'ethereum' },
          priority: 1,
          estimatedCost: 1,
        },
      ]),
    } as unknown as InvestigationPlanner;

    executorMock = {
      executeMany: vi.fn().mockResolvedValue([
        {
          success: true,
          capability: 'token_information',
          cacheHit: false,
          evidence: [createTestEvidence('evi_1')],
          actualCreditCost: 1,
          durationMs: 40,
          errors: [],
        } as ExecutionResult,
      ]),
    } as unknown as EvidenceExecutor;

    synthesizerMock = {
      synthesize: vi.fn().mockResolvedValue({
        success: true,
        answer: 'The available evidence shows active spot net accumulation.',
        observations: [
          {
            id: 'fnd_1',
            statement: 'PEPE experienced $500,000 in net spot volume',
            evidenceRefs: ['evi_1'],
          },
        ],
        interpretations: [
          {
            id: 'fnd_2',
            statement: 'Activity is consistent with organic buy pressure',
            confidence: 'high',
            evidenceRefs: ['evi_1'],
          },
        ],
        hypotheses: [],
        unknowns: [],
        evidenceRefs: ['evi_1'],
        followUpQuestions: ['Want me to investigate the top buyers?'],
        validated: true,
        investigationId: 'inv_test_orchestrator',
        createdAt: '2026-03-20T12:00:00.000Z',
      } as SynthesisResult),
    } as unknown as EvidenceSynthesisEngine;

    orchestrator = new InvestigationOrchestrator({
      planner: plannerMock,
      executor: executorMock,
      synthesizer: synthesizerMock,
      investigationManager: manager,
    });
  });

  // 1. New investigation completes successfully
  it('1. completes a new investigation turn successfully from question and token', async () => {
    const result = await orchestrator.executeTurn({
      question: 'Why is PEPE pumping?',
      token: TEST_TOKEN,
      chatId: 'chat_123',
    });

    expect(result.status).toBe('completed');
    expect(result.investigationId).toMatch(/^inv_/);
    expect(result.evidence).toHaveLength(1);
    expect(result.synthesis?.answer).toContain('The available evidence');
    expect(result.plan).toBeDefined();

    const storedInv = manager.getInvestigation(result.investigationId);
    expect(storedInv).toBeDefined();
    expect(storedInv?.state).toBe('ANSWERED');
  });

  // 2. Existing investigation follow-up completes successfully
  it('2. completes an existing investigation follow-up turn preserving context', async () => {
    const turn1 = await orchestrator.executeTurn({
      question: 'Why is PEPE pumping?',
      token: TEST_TOKEN,
      chatId: 'chat_123',
    });

    const turn2 = await orchestrator.executeTurn({
      investigationId: turn1.investigationId,
      question: 'Are whales actually buying?',
    });

    expect(turn2.status).toBe('completed');
    expect(turn2.investigationId).toBe(turn1.investigationId);
    expect(plannerMock.plan).toHaveBeenCalledTimes(2);

    // Verify planner received past conversation history
    const secondCallContext = vi.mocked(plannerMock.plan).mock.calls[1][0];
    expect(secondCallContext.conversationHistory).toHaveLength(2); // user turn 1 + assistant turn 1
  });

  // 3. Planner unresolved requirements return clarification
  it('3. returns clarification without executing calls when planner has unresolved requirements', async () => {
    vi.mocked(plannerMock.plan).mockResolvedValueOnce({
      planId: 'plan_unresolved',
      question: 'What did this wallet do?',
      intent: 'wallet_activity',
      evidenceRequirements: [
        {
          id: 'req_w',
          concept: 'wallet transaction history',
          priority: 'required',
          rationale: 'Inspect wallet activity',
          candidateCapabilities: ['wallet_transactions'],
          resolvedCapability: undefined,
          parameters: {},
        },
      ],
      selectedCapabilities: [],
      plannedCapabilities: [],
      estimatedCreditCost: 0,
      unresolvedRequirements: ['wallet transaction history'],
      warnings: [{ code: 'MISSING_WALLET_INPUT', message: 'Target wallet address required' }],
      createdAt: '2026-03-20T12:00:00.000Z',
    });

    const result = await orchestrator.executeTurn({
      question: 'What did this wallet do?',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.clarificationQuestions).toBeDefined();
    expect(result.clarificationQuestions![0]).toContain('wallet address');
    expect(executorMock.executeMany).not.toHaveBeenCalled();
    expect(synthesizerMock.synthesize).not.toHaveBeenCalled();
  });

  // 4. Planner failure is handled safely
  it('4. safely handles planner failure without throwing an unhandled exception', async () => {
    vi.mocked(plannerMock.plan).mockRejectedValueOnce(new Error('LLM rate limit / timeout'));

    const result = await orchestrator.executeTurn({
      question: 'Why is this token moving?',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('PLANNER_ERROR');
    expect(result.error?.message).toContain('LLM rate limit / timeout');
    expect(executorMock.executeMany).not.toHaveBeenCalled();
  });

  // 5. Evidence execution succeeds and evidence reaches synthesis
  it('5. verifies retrieved evidence items reach the synthesis engine', async () => {
    const evItem = createTestEvidence('evi_special_5');
    vi.mocked(executorMock.executeMany).mockResolvedValueOnce([
      {
        success: true,
        capability: 'token_information',
        cacheHit: false,
        evidence: [evItem],
        actualCreditCost: 1,
        durationMs: 30,
        errors: [],
      },
    ]);

    const result = await orchestrator.executeTurn({
      question: 'Show token status',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('completed');
    expect(synthesizerMock.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: [evItem],
      })
    );
  });

  // 6. Partial evidence is preserved after execution failure
  it('6. preserves partial evidence when one call succeeds and a later call fails', async () => {
    const partialEv = createTestEvidence('evi_partial_6');
    vi.mocked(executorMock.executeMany).mockResolvedValueOnce([
      {
        success: true,
        capability: 'token_information',
        cacheHit: false,
        evidence: [partialEv],
        actualCreditCost: 1,
        durationMs: 25,
        errors: [],
      },
      {
        success: false,
        capability: 'flow_intelligence',
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: 50,
        errors: ['Nansen API 500 Internal Server Error'],
      },
    ]);

    const result = await orchestrator.executeTurn({
      question: 'Analyze flows and price',
      token: TEST_TOKEN,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].evidenceId).toBe('evi_partial_6');
    expect(result.error?.code).toBe('PARTIAL_EXECUTION_FAILURE');
    expect(synthesizerMock.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: [partialEv],
      })
    );

    // Stored in manager
    const stored = manager.getInvestigation(result.investigationId);
    expect(stored?.evidence).toHaveLength(1);
  });

  // 7. Budget-limited execution is handled correctly
  it('7. handles budget limitation cleanly and records status as budget_limited', async () => {
    vi.mocked(executorMock.executeMany).mockResolvedValueOnce([
      {
        success: false,
        capability: 'token_information',
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: 5,
        errors: ['Monthly credit limit exceeded (budget limit 0 remaining)'],
      },
    ]);

    const result = await orchestrator.executeTurn({
      question: 'Check token metrics',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('budget_limited');
    expect(result.error?.code).toBe('BUDGET_EXCEEDED');
  });

  // 8. Empty evidence produces insufficient-evidence behavior
  it('8. handles empty evidence from execution with insufficient_evidence status', async () => {
    vi.mocked(executorMock.executeMany).mockResolvedValueOnce([
      {
        success: true,
        capability: 'token_information',
        cacheHit: false,
        evidence: [], // 0 items
        actualCreditCost: 1,
        durationMs: 20,
        errors: [],
      },
    ]);

    vi.mocked(synthesizerMock.synthesize).mockResolvedValueOnce({
      success: true,
      answer: 'The available evidence is insufficient to answer the query.',
      observations: [],
      interpretations: [],
      hypotheses: [],
      unknowns: [{ statement: 'No records found', reason: 'Empty on-chain results' }],
      evidenceRefs: [],
      followUpQuestions: ['Would you like to search on a different chain?'],
      validated: true,
      investigationId: 'inv_empty',
      createdAt: '2026-03-20T12:00:00.000Z',
    });

    const result = await orchestrator.executeTurn({
      question: 'Show non-existent transactions',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('insufficient_evidence');
    expect(result.evidence).toHaveLength(0);
    expect(result.synthesis?.answer).toContain('insufficient');
  });

  // 9. Synthesis failure is handled safely
  it('9. handles synthesis validation failure safely and returns structured error', async () => {
    vi.mocked(synthesizerMock.synthesize).mockResolvedValueOnce({
      success: false,
      answer: 'Validation failed',
      observations: [],
      interpretations: [],
      hypotheses: [],
      unknowns: [],
      evidenceRefs: [],
      followUpQuestions: [],
      validated: false,
      validationErrors: ['UNKNOWN_EVIDENCE_ID: evi_hallucinated'],
      investigationId: 'inv_fail',
      createdAt: '2026-03-20T12:00:00.000Z',
    });

    const result = await orchestrator.executeTurn({
      question: 'Analyze token',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('SYNTHESIS_VALIDATION_FAILED');
    expect(result.error?.message).toContain('UNKNOWN_EVIDENCE_ID');
  });

  // 10. Investigation state is updated after successful completion
  it('10. updates investigation state with messages, findings, and answered state', async () => {
    const result = await orchestrator.executeTurn({
      question: 'Why is PEPE pumping?',
      token: TEST_TOKEN,
    });

    const inv = manager.getInvestigation(result.investigationId);
    expect(inv).toBeDefined();
    expect(inv?.state).toBe('ANSWERED');
    expect(inv?.messages).toHaveLength(2); // user + assistant
    expect(inv?.findings.length).toBeGreaterThan(0);
    expect(inv?.timeline.some((t) => t.eventType === 'TURN_COMPLETED')).toBe(true);
  });

  // 11. Investigation state preserves evidence across turns
  it('11. preserves accumulated evidence across multiple turns', async () => {
    const ev1 = createTestEvidence('evi_turn1');
    const ev2 = createTestEvidence('evi_turn2', 'flow_intelligence');

    vi.mocked(executorMock.executeMany)
      .mockResolvedValueOnce([
        {
          success: true,
          capability: 'token_information',
          cacheHit: false,
          evidence: [ev1],
          actualCreditCost: 1,
          durationMs: 20,
          errors: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          success: true,
          capability: 'flow_intelligence',
          cacheHit: false,
          evidence: [ev2],
          actualCreditCost: 1,
          durationMs: 25,
          errors: [],
        },
      ]);

    const turn1 = await orchestrator.executeTurn({
      question: 'Turn 1 query',
      token: TEST_TOKEN,
    });

    const turn2 = await orchestrator.executeTurn({
      investigationId: turn1.investigationId,
      question: 'Turn 2 query',
    });

    const stored = manager.getInvestigation(turn1.investigationId);
    expect(stored?.evidence).toHaveLength(2);
    expect(stored?.evidence.map((e) => e.evidenceId)).toEqual(['evi_turn1', 'evi_turn2']);
    expect(turn2.evidence).toHaveLength(1);
    expect(turn2.evidence[0].evidenceId).toBe('evi_turn2');
  });

  // 12. Same investigation ID is preserved for follow-ups
  it('12. preserves the same investigation ID across sequential follow-up turns', async () => {
    const turn1 = await orchestrator.executeTurn({
      question: 'Initial question',
      token: TEST_TOKEN,
    });

    const turn2 = await orchestrator.executeTurn({
      investigationId: turn1.investigationId,
      question: 'Follow-up question 1',
    });

    const turn3 = await orchestrator.executeTurn({
      investigationId: turn1.investigationId,
      question: 'Follow-up question 2',
    });

    expect(turn2.investigationId).toBe(turn1.investigationId);
    expect(turn3.investigationId).toBe(turn1.investigationId);
  });

  // 13. No synthesis occurs when required inputs are unresolved
  it('13. prevents synthesis from executing when planner detects missing required inputs', async () => {
    vi.mocked(plannerMock.plan).mockResolvedValueOnce({
      planId: 'plan_unresolved_inputs',
      question: 'Who funded this wallet?',
      intent: 'wallet_relationships',
      evidenceRequirements: [
        {
          id: 'req_funder',
          concept: 'wallet first funder origin',
          priority: 'required',
          rationale: 'Trace origin gas funding',
          candidateCapabilities: ['wallet_first_funder'],
          resolvedCapability: undefined,
          parameters: {},
        },
      ],
      selectedCapabilities: [],
      plannedCapabilities: [],
      estimatedCreditCost: 0,
      unresolvedRequirements: ['wallet first funder origin'],
      warnings: [{ code: 'MISSING_WALLET_INPUT', message: 'Target wallet address required' }],
      createdAt: '2026-03-20T12:00:00.000Z',
    });

    await orchestrator.executeTurn({
      question: 'Who funded this wallet?',
      token: TEST_TOKEN,
    });

    expect(synthesizerMock.synthesize).not.toHaveBeenCalled();
  });

  // 14. No execution occurs for an unresolved/speculative plan
  it('14. prevents Nansen execution for a speculative, off-chain, or price prediction plan', async () => {
    vi.mocked(plannerMock.plan).mockResolvedValueOnce({
      planId: 'plan_speculative',
      question: 'Will PEPE reach $1.00 next week?',
      intent: 'unknown',
      evidenceRequirements: [
        {
          id: 'req_spec',
          concept: 'future price projection',
          priority: 'unresolved',
          rationale: 'Off-chain prediction cannot be established',
          candidateCapabilities: [],
          parameters: {},
        },
      ],
      selectedCapabilities: [],
      plannedCapabilities: [],
      estimatedCreditCost: 0,
      unresolvedRequirements: ['future price projection'],
      warnings: [],
      createdAt: '2026-03-20T12:00:00.000Z',
    });

    const result = await orchestrator.executeTurn({
      question: 'Will PEPE reach $1.00 next week?',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('needs_clarification');
    expect(executorMock.executeMany).not.toHaveBeenCalled();
    expect(synthesizerMock.synthesize).not.toHaveBeenCalled();
  });

  // 15. API/rate-limit failure does not crash the process
  it('15. safely catches and reports API rate-limit errors without crashing', async () => {
    vi.mocked(executorMock.executeMany).mockResolvedValueOnce([
      {
        success: false,
        capability: 'token_information',
        cacheHit: false,
        evidence: [],
        actualCreditCost: 0,
        durationMs: 15,
        errors: ['HTTP 429 Too Many Requests: Rate limit exceeded'],
      },
    ]);

    const result = await orchestrator.executeTurn({
      question: 'Show token info',
      token: TEST_TOKEN,
    });

    expect(result.status).toBe('insufficient_evidence');
    expect(result.error?.code).toBe('RATE_LIMIT_ERROR');
    expect(result.error?.message).toContain('429');
  });
});
