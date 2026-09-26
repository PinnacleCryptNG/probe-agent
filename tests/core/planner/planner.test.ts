import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../../../src/core/cache/memory-cache.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { CreditBudgetManager } from '../../../src/core/credit/budget-manager.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceNormalizer } from '../../../src/core/evidence/normalizer.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { CapabilitySelector } from '../../../src/core/planner/capability-selector.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { RequirementFormulator } from '../../../src/core/planner/requirements.js';
import { PlanEvidenceRequirement, PlannerContext } from '../../../src/core/planner/types.js';
import { INansenClient } from '../../../src/core/nansen/client.js';
import { TokenContext } from '../../../src/types/domain.js';

// ============================================================================
// TEST FIXTURES (Deterministic Mocks)
// ============================================================================

const TEST_FIXTURE_TOKEN: TokenContext = {
  address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  symbol: 'UNI',
  name: 'Uniswap',
  chain: 'ethereum',
  resolvedAt: '2026-09-24T12:00:00Z',
};

const TEST_FIXTURE_SOLANA_TOKEN: TokenContext = {
  address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  symbol: 'BONK',
  name: 'Bonk',
  chain: 'solana',
  resolvedAt: '2026-09-24T12:00:00Z',
};

describe('InvestigationPlanner (Phase 2B)', () => {
  let registry: CapabilityRegistry;
  let formulator: RequirementFormulator;
  let selector: CapabilitySelector;
  let planner: InvestigationPlanner;
  let mockLLM: MockLLMProvider;

  const defaultContext: PlannerContext = {
    token: TEST_FIXTURE_TOKEN,
    remainingCredits: 1100,
    maxCallsAllowed: 4,
    conversationHistory: [],
  };

  beforeEach(() => {
    registry = new CapabilityRegistry();
    formulator = new RequirementFormulator();
    selector = new CapabilitySelector(registry);
    mockLLM = new MockLLMProvider();

    planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: mockLLM,
      selector,
      formulator,
    });
  });

  // 1. Activity-change question
  it('1. plans activity_change without wasting credits on holder analysis', async () => {
    const plan = await planner.plan(defaultContext, 'Why is this token suddenly pumping?');

    expect(plan.intent).toBe('activity_change');
    expect(plan.selectedCapabilities).toContain('flow_intelligence');
    expect(plan.selectedCapabilities).toContain('who_bought_sold');
    expect(plan.selectedCapabilities).toContain('token_information');
    // Credit awareness: must NOT automatically select expensive 5-credit holder analysis
    expect(plan.selectedCapabilities).not.toContain('token_holders');
    // Epistemic boundary: causal market sentiment is recognized as unresolved
    expect(plan.unresolvedRequirements.length).toBeGreaterThan(0);
    expect(plan.unresolvedRequirements[0]).toContain('causal');
  });

  // 2. Accumulation question
  it('2. plans accumulation targeting top net buyers and cohort inflows', async () => {
    const plan = await planner.plan(defaultContext, 'Who is accumulating this token right now?');

    expect(plan.intent).toBe('accumulation');
    expect(plan.selectedCapabilities).toContain('who_bought_sold');
    expect(plan.selectedCapabilities).toContain('flow_intelligence');
    expect(plan.estimatedCreditCost).toBeLessThanOrEqual(4);
  });

  // 3. Distribution question
  it('3. plans distribution targeting top net sellers and whale outflows', async () => {
    const plan = await planner.plan(defaultContext, 'Are whales dumping this token today?');

    expect(plan.intent).toBe('distribution');
    expect(plan.selectedCapabilities).toContain('who_bought_sold');
    expect(plan.selectedCapabilities).toContain('flow_intelligence');
  });

  // 4. Holder question
  it('4. plans holder_analysis selecting token_holders capability only when necessary', async () => {
    const plan = await planner.plan(
      defaultContext,
      'Who are the top holders of this token and how concentrated is supply?'
    );

    expect(plan.intent).toBe('holder_analysis');
    expect(plan.selectedCapabilities).toContain('token_holders');
    // token_holders costs 5 credits
    expect(plan.estimatedCreditCost).toBeGreaterThanOrEqual(5);
  });

  // 5. Large-transfer question
  it('5. plans large_transactions targeting granular token transfers', async () => {
    const plan = await planner.plan(
      defaultContext,
      'What were the biggest transactions and largest transfers today?'
    );

    expect(plan.intent).toBe('large_transactions');
    expect(plan.selectedCapabilities).toContain('token_transfers');
  });

  // 6. Historical comparison
  it('6. plans historical_comparison using multi-day flow time series', async () => {
    const plan = await planner.plan(
      defaultContext,
      "Is today's activity unusual compared to last week's baseline?"
    );

    expect(plan.intent).toBe('historical_comparison');
    expect(plan.selectedCapabilities).toContain('historical_flows');
    expect(plan.selectedCapabilities).toContain('flow_intelligence');
  });

  // 7. Wallet activity question
  it('7. plans wallet_activity targeting transactions and balances', async () => {
    const plan = await planner.plan(
      {
        ...defaultContext,
        targetWalletAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      },
      'What is this target wallet doing?'
    );

    expect(plan.intent).toBe('wallet_activity');
    expect(plan.selectedCapabilities).toContain('wallet_transactions');
  });

  // 8. Arbitrary unsupported question
  it('8. classifies unsupported price speculation as unknown with unresolved requirements', async () => {
    const plan = await planner.plan(
      defaultContext,
      'Will this token reach $500 next month based on the dev team secret roadmap?'
    );

    expect(plan.intent).toBe('unknown');
    expect(plan.unresolvedRequirements).toContain(
      'future price projection or off-chain subjective intent'
    );
  });

  // 9. Unsupported capability request
  it('9. discards unregistered capability requests without inventing endpoints', () => {
    const bogusReq: PlanEvidenceRequirement = {
      id: 'req_bogus',
      concept: 'arbitrary unsupported metric',
      priority: 'required',
      rationale: 'Testing safety',
      candidateCapabilities: ['unregistered_capability_xyz' as any],
      parameters: { token_address: TEST_FIXTURE_TOKEN.address, chain: 'ethereum' },
    };

    const result = selector.select([bogusReq], defaultContext);

    expect(result.selectedCapabilities).toHaveLength(0);
    expect(result.unresolvedRequirements).toContain('arbitrary unsupported metric');
    expect(result.warnings.some((w) => w.code === 'UNREGISTERED_CAPABILITY')).toBe(true);
  });

  // 10. Deduplication
  it('10. deduplicates capabilities when multiple requirements suggest the same capability', () => {
    const req1: PlanEvidenceRequirement = {
      id: 'req_1',
      concept: 'cohort inflows',
      priority: 'required',
      rationale: 'Reason 1',
      candidateCapabilities: ['flow_intelligence'],
      parameters: { token_address: TEST_FIXTURE_TOKEN.address, chain: 'ethereum' },
    };
    const req2: PlanEvidenceRequirement = {
      id: 'req_2',
      concept: 'cohort outflows',
      priority: 'required',
      rationale: 'Reason 2',
      candidateCapabilities: ['flow_intelligence'],
      parameters: { token_address: TEST_FIXTURE_TOKEN.address, chain: 'ethereum' },
    };

    const result = selector.select([req1, req2], defaultContext);

    expect(result.selectedCapabilities).toEqual(['flow_intelligence']);
    expect(result.selectedCapabilities).toHaveLength(1);
    expect(result.estimatedCreditCost).toBe(1);
  });

  // 11. Credit estimation
  it('11. accurately calculates total credit cost for all planned capabilities', async () => {
    const plan = await planner.plan(defaultContext, 'Who is accumulating?');
    // who_bought_sold (1) + flow_intelligence (1) + dex_trades (1) = 3
    const expected = plan.selectedCapabilities.reduce(
      (sum, cap) => sum + registry.getEstimatedCost(cap),
      0
    );

    expect(plan.estimatedCreditCost).toBe(expected);
  });

  // 12. Expensive holder capability only selected when necessary
  it('12. strictly avoids selecting 5-credit token_holders for general pump/dump queries', async () => {
    const pumpPlan = await planner.plan(defaultContext, 'What caused this token to spike today?');
    expect(pumpPlan.selectedCapabilities).not.toContain('token_holders');

    const holderPlan = await planner.plan(defaultContext, 'Show me the top 10 token holders');
    expect(holderPlan.selectedCapabilities).toContain('token_holders');
  });

  // 13. Follow-up context
  it('13. resolves pronoun references in follow-up questions using conversation history', async () => {
    const contextWithHistory: PlannerContext = {
      ...defaultContext,
      conversationHistory: [
        {
          id: 'msg_1',
          investigationId: 'inv_1',
          role: 'user',
          content: 'Who bought the most tokens today?',
          timestamp: '2026-09-24T12:00:00Z',
        },
        {
          id: 'msg_2',
          investigationId: 'inv_1',
          role: 'assistant',
          content: 'Top buyers were 0x123... and 0x456...',
          timestamp: '2026-09-24T12:01:00Z',
        },
      ],
    };

    // User asks a follow-up referring to "those tokens afterward"
    const followUpPlan = await planner.plan(contextWithHistory, 'What happened to those tokens afterward?');

    expect(followUpPlan.intent).toBe('transfers');
    expect(followUpPlan.selectedCapabilities).toContain('token_transfers');
  });

  // 14. Unresolved evidence requirement
  it('14. preserves epistemic boundaries by marking causal/off-chain claims as unresolved', async () => {
    const plan = await planner.plan(defaultContext, 'Why did this token pump?');

    const causalReq = plan.evidenceRequirements.find((r) => r.priority === 'unresolved');
    expect(causalReq).toBeDefined();
    expect(causalReq?.concept).toContain('causal market sentiment');
    expect(plan.unresolvedRequirements).toContain(causalReq?.concept);
  });

  // 15. Chain incompatibility
  it('15. rejects capabilities that do not support the target chain and issues warning', async () => {
    const solanaContext: PlannerContext = {
      ...defaultContext,
      token: TEST_FIXTURE_SOLANA_TOKEN,
      targetWalletAddress: 'SolanaWalletAddress11111111111111111111111',
    };

    // wallet_transactions is explicitly unsupported on Solana in Nansen API
    const req: PlanEvidenceRequirement = {
      id: 'req_sol',
      concept: 'wallet transaction history',
      priority: 'required',
      rationale: 'Checking wallet activity on Solana',
      candidateCapabilities: ['wallet_transactions'],
      parameters: { address: 'SolanaWalletAddress11111111111111111111111', chain: 'solana' },
    };

    const result = selector.select([req], solanaContext);

    expect(result.selectedCapabilities).not.toContain('wallet_transactions');
    expect(result.warnings.some((w) => w.code === 'CHAIN_UNSUPPORTED')).toBe(true);
    expect(result.unresolvedRequirements).toContain('wallet transaction history');
  });

  // 16. Integration: InvestigationPlan -> EvidenceRequirement[] -> EvidenceExecutor.executeMany()
  it('16. demonstrates clean integration from plan to EvidenceExecutor.executeMany', async () => {
    const mockNansenClient: INansenClient = {
      execute: vi.fn(),
      searchGeneral: vi.fn(),
      getTokenInformation: vi.fn().mockResolvedValue({
        data: { symbol: 'UNI', name: 'Uniswap', decimals: 18, price_usd: 10 },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 1099, durationMs: 20 },
      }),
      getFlowIntelligence: vi.fn().mockResolvedValue({
        data: { smart_money: { net_flow_usd: 50000 } },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 1098, durationMs: 25 },
      }),
      getWhoBoughtSold: vi.fn().mockResolvedValue({
        data: { buyers: [{ address: '0xabc', bought_volume_usd: 100000 }] },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 1097, durationMs: 22 },
      }),
      getDexTrades: vi.fn().mockResolvedValue({
        data: {
          trades: [
            {
              transaction_hash: '0x1',
              timestamp: '2026-09-24T12:00:00Z',
              trade_type: 'BUY',
              trader_address: '0x123',
              token_amount: '100',
            },
          ],
        },
        meta: { creditsCost: 1, creditsUsed: 1, creditsRemaining: 1096, durationMs: 20 },
      }),
      getHistoricalFlows: vi.fn(),
      getTokenHolders: vi.fn(),
      getWalletBalance: vi.fn(),
      getWalletTransactions: vi.fn(),
      getRelatedWallets: vi.fn(),
      getFirstFunder: vi.fn(),
      getCounterparties: vi.fn(),
      lookupTransaction: vi.fn(),
    };

    const creditManager = new CreditBudgetManager({ totalBudget: 1100, maxCallsPerTurn: 4 });
    const cache = new MemoryCache();
    const normalizer = new EvidenceNormalizer();

    const executor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager,
      cache,
      normalizer,
    });

    // 1. Generate plan
    const plan = await planner.plan(defaultContext, 'Who is accumulating?');
    expect(plan.selectedCapabilities.length).toBeGreaterThan(0);

    // 2. Convert plan to executable requirements
    const executableRequirements = planner.toExecutableRequirements(plan);
    expect(executableRequirements.length).toBe(plan.selectedCapabilities.length);

    // 3. Execute via EvidenceExecutor
    const executionResults = await executor.executeMany(executableRequirements, {
      investigationId: 'inv_integration_test',
      turnKey: 'inv_integration_test:turn_1',
      tokenAddress: defaultContext.token.address,
      chain: defaultContext.token.chain,
    });

    expect(executionResults).toHaveLength(executableRequirements.length);
    expect(executionResults.every((r) => r.success)).toBe(true);
    expect(executionResults[0].evidence.length).toBeGreaterThan(0);
    expect(executionResults[0].evidence[0].epistemicStatus).toBe('OBSERVATION');
  });

  // 17. Challenge Mode: generates verification and cross-examination plan
  it('17. planChallenge creates focused cross-examination plan for challenged finding', async () => {
    const challengePlan = await planner.planChallenge(
      defaultContext,
      'I disagree that whales accumulated; they were just shuffling funds to an exchange.',
      'fnd_123'
    );

    expect(challengePlan.intent).toBe('historical_comparison');
    expect(challengePlan.selectedCapabilities).toContain('who_bought_sold');
    expect(challengePlan.selectedCapabilities).toContain('dex_trades');
  });
});
