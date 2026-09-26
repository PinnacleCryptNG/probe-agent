import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../../../src/core/cache/memory-cache.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { CreditBudgetManager } from '../../../src/core/credit/budget-manager.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceNormalizer } from '../../../src/core/evidence/normalizer.js';
import { ExecutionContext } from '../../../src/core/evidence/types.js';
import { INansenClient } from '../../../src/core/nansen/client.js';
import {
  FlowIntelligenceResponse,
  NansenApiResponse,
  TokenHoldersResponse,
  TokenInformationResponse,
  WalletTransactionsResponse,
} from '../../../src/core/nansen/types.js';
import { EvidenceRequirement } from '../../../src/types/domain.js';
import {
  NansenAuthenticationError,
  NansenRateLimitError,
  NansenUnavailableError,
} from '../../../src/types/errors.js';

// ============================================================================
// TEST FIXTURES (Explicitly Mocked Nansen Response Payloads)
// ============================================================================

const TEST_FIXTURE_TOKEN_INFORMATION: TokenInformationResponse = {
  token_address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  chain: 'ethereum',
  symbol: 'UNI',
  name: 'Uniswap',
  decimals: 18,
  price_usd: 10.5,
  market_cap_usd: 6300000000,
  volume_24h_usd: 150000000,
};

const TEST_FIXTURE_FLOW_INTELLIGENCE: FlowIntelligenceResponse = {
  token_address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  chain: 'ethereum',
  whales: { inflow_usd: 500000, outflow_usd: 100000, net_flow_usd: 400000, active_wallets_count: 5 },
  smart_money: { inflow_usd: 1200000, outflow_usd: 300000, net_flow_usd: 900000, active_wallets_count: 12 },
  fresh_wallets: { inflow_usd: 150000, outflow_usd: 50000, net_flow_usd: 100000, active_wallets_count: 20 },
  exchanges: { inflow_usd: 2000000, outflow_usd: 2500000, net_flow_usd: -500000, active_wallets_count: 8 },
};

const TEST_FIXTURE_TOKEN_HOLDERS: TokenHoldersResponse = {
  holders: [
    { address: '0x0000000000000000000000000000000000000001', balance: '10000000', percentage_held: 10.0, label: 'Treasury' },
    { address: '0x0000000000000000000000000000000000000002', balance: '5000000', percentage_held: 5.0, label: 'Binance' },
  ],
  top_10_percentage: 45.5,
  top_50_percentage: 72.3,
};

const TEST_FIXTURE_WALLET_TRANSACTIONS: WalletTransactionsResponse = {
  transactions: [
    {
      transaction_hash: '0xabc123',
      timestamp: '2026-09-24T12:00:00Z',
      from_address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      to_address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
      value_usd: 2500,
    },
  ],
};

function createMockNansenResponse<T>(data: T, creditsCost = 1): NansenApiResponse<T> {
  return {
    data,
    meta: {
      creditsCost,
      creditsUsed: creditsCost,
      creditsRemaining: 1099,
      durationMs: 45,
    },
  };
}

describe('EvidenceExecutor (Phase 2A Evidence Execution Engine)', () => {
  let mockNansenClient: INansenClient;
  let registry: CapabilityRegistry;
  let creditManager: CreditBudgetManager;
  let cache: MemoryCache;
  let normalizer: EvidenceNormalizer;
  let executor: EvidenceExecutor;

  const defaultContext: ExecutionContext = {
    investigationId: 'inv_test_123',
    turnKey: 'inv_test_123:turn_1',
    tokenAddress: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    chain: 'ethereum',
    userId: 'usr_test_999',
  };

  beforeEach(() => {
    mockNansenClient = {
      execute: vi.fn(),
      searchGeneral: vi.fn(),
      getTokenInformation: vi.fn().mockResolvedValue(createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 1)),
      getFlowIntelligence: vi.fn().mockResolvedValue(createMockNansenResponse(TEST_FIXTURE_FLOW_INTELLIGENCE, 1)),
      getWhoBoughtSold: vi.fn(),
      getTokenTransfers: vi.fn(),
      getDexTrades: vi.fn(),
      getHistoricalFlows: vi.fn(),
      getTokenHolders: vi.fn().mockResolvedValue(createMockNansenResponse(TEST_FIXTURE_TOKEN_HOLDERS, 5)),
      getWalletBalance: vi.fn(),
      getWalletTransactions: vi.fn().mockResolvedValue(createMockNansenResponse(TEST_FIXTURE_WALLET_TRANSACTIONS, 1)),
      getRelatedWallets: vi.fn(),
      getFirstFunder: vi.fn(),
      getCounterparties: vi.fn(),
      lookupTransaction: vi.fn(),
    };

    registry = new CapabilityRegistry();
    creditManager = new CreditBudgetManager({ totalBudget: 1100, maxCallsPerTurn: 4 });
    cache = new MemoryCache(300);
    normalizer = new EvidenceNormalizer();

    executor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager,
      cache,
      normalizer,
    });
  });

  // 1. Successful uncached execution
  it('1. performs successful uncached execution and returns normalized evidence', async () => {
    const requirement: EvidenceRequirement = {
      id: 'req_1',
      capabilityName: 'flow_intelligence',
      reason: 'Inspect cohort-level inflows',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
        time_frame: '24h',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(true);
    expect(result.cacheHit).toBe(false);
    expect(result.actualCreditCost).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].epistemicStatus).toBe('OBSERVATION');
    expect(result.evidence[0].title).toContain('Cohort Net Flows');
    expect(result.provenance).toBeDefined();
    expect(result.provenance?.capability).toBe('flow_intelligence');
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1);
  });

  // 2. Cache hit avoids Nansen call
  it('2. avoids Nansen call on subsequent execution when evidence is cached', async () => {
    const requirement: EvidenceRequirement = {
      id: 'req_2',
      capabilityName: 'flow_intelligence',
      reason: 'Inspect cohort net flows',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
        time_frame: '24h',
      },
      priority: 1,
      estimatedCost: 1,
    };

    // First call: uncached
    const firstResult = await executor.execute(requirement, defaultContext);
    expect(firstResult.success).toBe(true);
    expect(firstResult.cacheHit).toBe(false);
    expect(firstResult.actualCreditCost).toBe(1);
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1);

    // Second call: should hit cache
    const secondResult = await executor.execute(requirement, defaultContext);
    expect(secondResult.success).toBe(true);
    expect(secondResult.cacheHit).toBe(true);
    expect(secondResult.actualCreditCost).toBe(0); // Zero credits spent
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1); // Not called again
    expect(secondResult.evidence).toEqual(firstResult.evidence);
  });

  // 3. Unsupported capability
  it('3. rejects unsupported capabilities safely without calling Nansen', async () => {
    const requirement: EvidenceRequirement = {
      id: 'req_3',
      capabilityName: 'non_existent_capability' as any,
      reason: 'Try to run an invalid capability',
      parameters: { token_address: '0x123', chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toHaveLength(0);
    expect(result.actualCreditCost).toBe(0);
    expect(result.errors[0]).toContain("Capability 'non_existent_capability' is not supported");
    expect(mockNansenClient.execute).not.toHaveBeenCalled();
  });

  // 4. Unsupported chain
  it('4. rejects execution when capability does not support the requested chain', async () => {
    // wallet_transactions is explicitly not supported on Solana in Nansen API
    const requirement: EvidenceRequirement = {
      id: 'req_4',
      capabilityName: 'wallet_transactions',
      reason: 'Retrieve wallet transactions on Solana',
      parameters: {
        address: 'SolanaWalletAddressExample11111111111111111',
        chain: 'solana',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, {
      ...defaultContext,
      chain: 'solana',
    });

    expect(result.success).toBe(false);
    expect(result.evidence).toHaveLength(0);
    expect(result.actualCreditCost).toBe(0);
    expect(result.errors[0]).toContain("Chain 'solana' is not supported for capability 'wallet_transactions'");
    expect(mockNansenClient.getWalletTransactions).not.toHaveBeenCalled();
  });

  // 5. Invalid capability parameters
  it('5. validates inputs and rejects invalid parameters before execution', async () => {
    const requirement: EvidenceRequirement = {
      id: 'req_5',
      capabilityName: 'token_information',
      reason: 'Fetch token metadata with missing address',
      parameters: {
        // Missing required token_address!
        chain: 'ethereum',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toHaveLength(0);
    expect(result.errors[0]).toContain("Validation failed for capability 'token_information'");
    expect(mockNansenClient.getTokenInformation).not.toHaveBeenCalled();
  });

  // 6. Credit budget rejection
  it('6. rejects execution when credit budget is insufficient', async () => {
    // Budget only has 2 credits remaining
    const lowBudgetManager = new CreditBudgetManager({ totalBudget: 2, maxCallsPerTurn: 4 });
    const lowBudgetExecutor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager: lowBudgetManager,
      cache,
      normalizer,
    });

    // token_holders costs 5 credits
    const requirement: EvidenceRequirement = {
      id: 'req_6',
      capabilityName: 'token_holders',
      reason: 'Inspect top holders',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
      },
      priority: 1,
      estimatedCost: 5,
    };

    const result = await lowBudgetExecutor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toHaveLength(0);
    expect(result.actualCreditCost).toBe(0);
    expect(result.errors[0]).toContain('Credit budget exceeded: requested cost 5 credits, but only 2 credits remain');
    expect(mockNansenClient.getTokenHolders).not.toHaveBeenCalled();
  });

  // 7. Per-turn call limit rejection
  it('7. rejects execution when maximum allowed calls per turn is exceeded', async () => {
    const strictTurnBudgetManager = new CreditBudgetManager({ totalBudget: 100, maxCallsPerTurn: 2 });
    const turnExecutor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager: strictTurnBudgetManager,
      cache,
      normalizer,
    });

    const req1: EvidenceRequirement = {
      id: 'req_7_1',
      capabilityName: 'token_information',
      reason: 'Call 1',
      parameters: { token_address: '0x123', chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };
    const req2: EvidenceRequirement = {
      id: 'req_7_2',
      capabilityName: 'token_information',
      reason: 'Call 2',
      parameters: { token_address: '0x456', chain: 'ethereum' },
      priority: 2,
      estimatedCost: 1,
    };
    const req3: EvidenceRequirement = {
      id: 'req_7_3',
      capabilityName: 'token_information',
      reason: 'Call 3 (Exceeds turn limit of 2)',
      parameters: { token_address: '0x789', chain: 'ethereum' },
      priority: 3,
      estimatedCost: 1,
    };

    const res1 = await turnExecutor.execute(req1, defaultContext);
    const res2 = await turnExecutor.execute(req2, defaultContext);
    const res3 = await turnExecutor.execute(req3, defaultContext);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res3.success).toBe(false);
    expect(res3.errors[0]).toContain('Exceeded maximum allowed Nansen calls per turn: attempted 3, maximum is 2');
    expect(mockNansenClient.getTokenInformation).toHaveBeenCalledTimes(2);
  });

  // 8. Nansen authentication failure
  it('8. handles Nansen authentication errors safely without producing fake evidence', async () => {
    vi.mocked(mockNansenClient.getFlowIntelligence).mockRejectedValueOnce(
      new NansenAuthenticationError('Invalid Nansen API key (401)')
    );

    const requirement: EvidenceRequirement = {
      id: 'req_8',
      capabilityName: 'flow_intelligence',
      reason: 'Check flows',
      parameters: { token_address: defaultContext.tokenAddress!, chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]).toContain('Invalid Nansen API key');
  });

  // 9. Nansen rate limit
  it('9. handles Nansen rate limit errors safely', async () => {
    vi.mocked(mockNansenClient.getFlowIntelligence).mockRejectedValueOnce(
      new NansenRateLimitError('Nansen rate limit reached (429)', 60)
    );

    const requirement: EvidenceRequirement = {
      id: 'req_9',
      capabilityName: 'flow_intelligence',
      reason: 'Check flows under rate limit',
      parameters: { token_address: defaultContext.tokenAddress!, chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]).toContain('Nansen rate limit reached');
  });

  // 10. Nansen API failure
  it('10. handles generic Nansen API errors safely', async () => {
    vi.mocked(mockNansenClient.getFlowIntelligence).mockRejectedValueOnce(
      new NansenUnavailableError('Nansen API timed out after 15000ms')
    );

    const requirement: EvidenceRequirement = {
      id: 'req_10',
      capabilityName: 'flow_intelligence',
      reason: 'Check flows during timeout',
      parameters: { token_address: defaultContext.tokenAddress!, chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.errors[0]).toContain('Nansen API timed out');
  });

  // 11. Evidence provenance
  it('11. preserves full provenance linking evidence to endpoint, capability, and params', async () => {
    const requirement: EvidenceRequirement = {
      id: 'req_11',
      capabilityName: 'token_information',
      reason: 'Verify provenance fields',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(true);
    expect(result.provenance).toBeDefined();

    const prov = result.provenance!;
    expect(prov.source).toBe('nansen');
    expect(prov.capability).toBe('token_information');
    expect(prov.endpoint).toBe('/api/v1/tgm/token-information');
    expect(prov.chain).toBe('ethereum');
    expect(prov.tokenAddress).toBe(defaultContext.tokenAddress?.toLowerCase());
    expect(prov.creditsCost).toBe(1);
    expect(new Date(prov.retrievedAt).getTime()).not.toBeNaN();

    // Check that evidence item also encapsulates the identical provenance
    expect(result.evidence[0].provenance).toEqual(prov);
  });

  // 12. Actual credit header accounting
  it('12. records actual credits returned from Nansen headers over initial estimate', async () => {
    // Capability default is 1, but API response meta returns 3 credits used
    vi.mocked(mockNansenClient.getTokenInformation).mockResolvedValueOnce(
      createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 3)
    );

    const requirement: EvidenceRequirement = {
      id: 'req_12',
      capabilityName: 'token_information',
      reason: 'Verify header credit deduction',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const initialSpent = creditManager.getSpentBudget();
    const result = await executor.execute(requirement, defaultContext);

    expect(result.success).toBe(true);
    expect(result.actualCreditCost).toBe(3);
    expect(creditManager.getSpentBudget() - initialSpent).toBe(3);
  });

  // 13. Deterministic cache behavior
  it('13. produces identical cache hits regardless of query parameter key ordering', async () => {
    const reqKeyOrderA: EvidenceRequirement = {
      id: 'req_13_a',
      capabilityName: 'flow_intelligence',
      reason: 'Order A',
      parameters: {
        token_address: defaultContext.tokenAddress!,
        chain: 'ethereum',
        time_frame: '24h',
      },
      priority: 1,
      estimatedCost: 1,
    };

    const reqKeyOrderB: EvidenceRequirement = {
      id: 'req_13_b',
      capabilityName: 'flow_intelligence',
      reason: 'Order B (reversed key insertion)',
      parameters: {
        time_frame: '24h',
        chain: 'ethereum',
        token_address: defaultContext.tokenAddress!,
      },
      priority: 1,
      estimatedCost: 1,
    };

    const resA = await executor.execute(reqKeyOrderA, defaultContext);
    expect(resA.cacheHit).toBe(false);
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1);

    const resB = await executor.execute(reqKeyOrderB, defaultContext);
    expect(resB.cacheHit).toBe(true);
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1);
    expect(resB.evidence).toEqual(resA.evidence);
  });

  // Bonus test: executeMany handles batch execution with priority order
  it('14. executeMany executes requirements in priority order', async () => {
    const reqs: EvidenceRequirement[] = [
      {
        id: 'req_p2',
        capabilityName: 'flow_intelligence',
        reason: 'Priority 2',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 2,
        estimatedCost: 1,
      },
      {
        id: 'req_p1',
        capabilityName: 'token_information',
        reason: 'Priority 1',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 1,
        estimatedCost: 1,
      },
    ];

    const results = await executor.executeMany(reqs, defaultContext);

    expect(results).toHaveLength(2);
    expect(results[0].capability).toBe('token_information');
    expect(results[1].capability).toBe('flow_intelligence');
  });

  // 15. Concurrent execution
  it('15. concurrent executeMany executes independent requirements concurrently', async () => {
    let call1Active = false;
    let call2Active = false;
    let overlapped = false;

    vi.mocked(mockNansenClient.getTokenInformation).mockImplementation(async () => {
      call1Active = true;
      if (call2Active) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      call1Active = false;
      return createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 1);
    });

    vi.mocked(mockNansenClient.getFlowIntelligence).mockImplementation(async () => {
      call2Active = true;
      if (call1Active) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 30));
      call2Active = false;
      return createMockNansenResponse(TEST_FIXTURE_FLOW_INTELLIGENCE, 1);
    });

    const reqs: EvidenceRequirement[] = [
      {
        id: 'req_conc_1',
        capabilityName: 'token_information',
        reason: 'Call 1',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 1,
        estimatedCost: 1,
      },
      {
        id: 'req_conc_2',
        capabilityName: 'flow_intelligence',
        reason: 'Call 2',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 2,
        estimatedCost: 1,
      },
    ];

    const results = await executor.executeMany(reqs, defaultContext);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(overlapped).toBe(true);
  });

  // 16. Partial failure tolerance
  it('16. preserves successful evidence when one concurrent requirement fails', async () => {
    vi.mocked(mockNansenClient.getTokenInformation).mockResolvedValueOnce(
      createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 1)
    );
    vi.mocked(mockNansenClient.getFlowIntelligence).mockRejectedValueOnce(
      new NansenUnavailableError('Nansen 500 Internal Error')
    );

    const reqs: EvidenceRequirement[] = [
      {
        id: 'req_success',
        capabilityName: 'token_information',
        reason: 'Succeeding capability',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 1,
        estimatedCost: 1,
      },
      {
        id: 'req_fail',
        capabilityName: 'flow_intelligence',
        reason: 'Failing capability',
        parameters: { token_address: '0x123', chain: 'ethereum' },
        priority: 2,
        estimatedCost: 1,
      },
    ];

    const results = await executor.executeMany(reqs, defaultContext);

    expect(results).toHaveLength(2);
    // Successful requirement produced evidence
    expect(results[0].success).toBe(true);
    expect(results[0].evidence.length).toBeGreaterThan(0);
    // Failed requirement has error and did not discard successful evidence
    expect(results[1].success).toBe(false);
    expect(results[1].errors[0]).toContain('Nansen 500 Internal Error');
  });

  // 17. Credit budget race condition prevention
  it('17. prevents credit budget over-allocation race condition during concurrent execution', async () => {
    // Only 2 credits available in total
    const lowCreditManager = new CreditBudgetManager({ totalBudget: 2, maxCallsPerTurn: 10 });
    const raceExecutor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager: lowCreditManager,
      cache,
      normalizer,
    });

    vi.mocked(mockNansenClient.getTokenInformation).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 1);
    });

    // 3 requirements, each costing 1 credit
    const reqs: EvidenceRequirement[] = [
      {
        id: 'req_race_1',
        capabilityName: 'token_information',
        reason: 'Call 1',
        parameters: { token_address: '0x111', chain: 'ethereum' },
        priority: 1,
        estimatedCost: 1,
      },
      {
        id: 'req_race_2',
        capabilityName: 'token_information',
        reason: 'Call 2',
        parameters: { token_address: '0x222', chain: 'ethereum' },
        priority: 2,
        estimatedCost: 1,
      },
      {
        id: 'req_race_3',
        capabilityName: 'token_information',
        reason: 'Call 3 (Must be rejected, exceeding budget of 2)',
        parameters: { token_address: '0x333', chain: 'ethereum' },
        priority: 3,
        estimatedCost: 1,
      },
    ];

    const results = await raceExecutor.executeMany(reqs, defaultContext);

    expect(results).toHaveLength(3);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].errors[0]).toContain('Credit budget exceeded');
    expect(lowCreditManager.getSpentBudget()).toBeLessThanOrEqual(2);
    expect(lowCreditManager.getRemainingBudget()).toBeGreaterThanOrEqual(0);
  });

  // 18. Per-turn call limit enforcement during concurrent execution
  it('18. prevents turn call counter race condition during concurrent execution', async () => {
    const strictTurnManager = new CreditBudgetManager({ totalBudget: 100, maxCallsPerTurn: 2 });
    const turnExecutor = new EvidenceExecutor({
      capabilityRegistry: registry,
      nansenClient: mockNansenClient,
      creditManager: strictTurnManager,
      cache,
      normalizer,
    });

    vi.mocked(mockNansenClient.getTokenInformation).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return createMockNansenResponse(TEST_FIXTURE_TOKEN_INFORMATION, 1);
    });

    const reqs: EvidenceRequirement[] = [
      {
        id: 'req_turn_1',
        capabilityName: 'token_information',
        reason: 'Call 1',
        parameters: { token_address: '0x111', chain: 'ethereum' },
        priority: 1,
        estimatedCost: 1,
      },
      {
        id: 'req_turn_2',
        capabilityName: 'token_information',
        reason: 'Call 2',
        parameters: { token_address: '0x222', chain: 'ethereum' },
        priority: 2,
        estimatedCost: 1,
      },
      {
        id: 'req_turn_3',
        capabilityName: 'token_information',
        reason: 'Call 3 (Must exceed turn limit of 2)',
        parameters: { token_address: '0x333', chain: 'ethereum' },
        priority: 3,
        estimatedCost: 1,
      },
    ];

    const results = await turnExecutor.executeMany(reqs, {
      ...defaultContext,
      turnKey: 'test_turn_strict_concurrency',
    });

    expect(results).toHaveLength(3);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].errors[0]).toContain('Exceeded maximum allowed Nansen calls per turn: attempted 3, maximum is 2');
    expect(strictTurnManager.getTurnCallCount('test_turn_strict_concurrency')).toBe(2);
  });

  // 19. Cache hits alongside live calls
  it('19. concurrent executeMany preserves cache hits alongside live calls', async () => {
    const reqCached: EvidenceRequirement = {
      id: 'req_cached',
      capabilityName: 'token_information',
      reason: 'In cache',
      parameters: { token_address: '0x123', chain: 'ethereum' },
      priority: 1,
      estimatedCost: 1,
    };

    const reqLive: EvidenceRequirement = {
      id: 'req_live',
      capabilityName: 'flow_intelligence',
      reason: 'Live network call',
      parameters: { token_address: '0x123', chain: 'ethereum' },
      priority: 2,
      estimatedCost: 1,
    };

    // 1. Populate cache for token_information by executing once
    const firstRes = await executor.execute(reqCached, defaultContext);
    expect(firstRes.cacheHit).toBe(false);
    expect(mockNansenClient.getTokenInformation).toHaveBeenCalledTimes(1);

    vi.mocked(mockNansenClient.getFlowIntelligence).mockResolvedValueOnce(
      createMockNansenResponse(TEST_FIXTURE_FLOW_INTELLIGENCE, 1)
    );

    // 2. Execute concurrently: reqCached will hit cache, reqLive will hit mock client
    const results = await executor.executeMany([reqCached, reqLive], defaultContext);

    expect(results).toHaveLength(2);
    expect(results[0].cacheHit).toBe(true);
    expect(results[0].actualCreditCost).toBe(0);
    expect(results[1].cacheHit).toBe(false);
    expect(results[1].actualCreditCost).toBe(1);
    expect(mockNansenClient.getTokenInformation).toHaveBeenCalledTimes(1);
    expect(mockNansenClient.getFlowIntelligence).toHaveBeenCalledTimes(1);
  });
});
