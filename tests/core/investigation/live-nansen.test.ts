import { describe, expect, it } from 'vitest';
import 'dotenv/config';
import { NansenClient } from '../../../src/core/nansen/client.js';
import { CreditBudgetManager } from '../../../src/core/credit/budget-manager.js';
import { MemoryCache } from '../../../src/core/cache/memory-cache.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { TokenContext } from '../../../src/types/domain.js';

const isLive = process.env.RUN_LIVE_NANSEN_TESTS === 'true' && !!process.env.NANSEN_API_KEY;

describe.skipIf(!isLive)('Live Nansen Integration Test (guarded by RUN_LIVE_NANSEN_TESTS=true)', () => {
  it('executes a real ETH investigation plan against Nansen API and produces real EvidenceItems', async () => {
    const nansenClient = new NansenClient({
      apiKey: process.env.NANSEN_API_KEY!,
      baseUrl: process.env.NANSEN_API_BASE_URL || 'https://api.nansen.ai',
    });

    const creditManager = new CreditBudgetManager({
      totalBudget: 500,
      maxCallsPerTurn: 10,
    });

    const cache = new MemoryCache();
    const registry = new CapabilityRegistry();
    const executor = new EvidenceExecutor({
      nansenClient,
      creditManager,
      cache,
      capabilityRegistry: registry,
    });

    const planner = new InvestigationPlanner({
      capabilityRegistry: registry,
    });

    const ethToken: TokenContext = {
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'ETH',
      name: 'Ethereum',
      chain: 'ethereum',
      decimals: 18,
      resolvedAt: new Date().toISOString(),
    };

    // 1. Planner generates real requirements
    const plan = await planner.plan(
      {
        token: ethToken,
        remainingCredits: 1000,
        maxCallsAllowed: 4,
        conversationHistory: [],
      },
      "What's happening?"
    );

    expect(plan.evidenceRequirements.length).toBeGreaterThan(0);

    // 2. EvidenceExecutor executes real requirements against Nansen API
    const executableReqs = planner.toExecutableRequirements(plan);
    const execContext = {
      investigationId: 'live_test_inv',
      turnKey: 'live_test_inv:turn_1',
      tokenAddress: ethToken.address,
      chain: ethToken.chain,
    };
    const results = await executor.executeMany(executableReqs, execContext);
    const items = results.flatMap((r) => r.evidence);

    // Verify at least one real EvidenceItem produced from live Nansen API
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.evidenceId).toBeDefined();
      expect(item.provenance.source).toBe('nansen');
      expect(item.provenance.retrievedAt).toBeDefined();
      expect(item.summary.length).toBeGreaterThan(0);
      expect(item.epistemicStatus).toBe('OBSERVATION');
      expect(item.normalizedData).toBeDefined();
    }
  }, 30000);

  it('runs complete InvestigationOrchestrator turn on ETH with live Nansen and synthesis', async () => {
    const nansenClient = new NansenClient({
      apiKey: process.env.NANSEN_API_KEY!,
      baseUrl: process.env.NANSEN_API_BASE_URL || 'https://api.nansen.ai',
    });

    const creditManager = new CreditBudgetManager({
      totalBudget: 500,
      maxCallsPerTurn: 10,
    });

    const cache = new MemoryCache();
    const registry = new CapabilityRegistry();
    const executor = new EvidenceExecutor({
      nansenClient,
      creditManager,
      cache,
      capabilityRegistry: registry,
    });

    const planner = new InvestigationPlanner({
      capabilityRegistry: registry,
    });

    const llmProvider = new MockLLMProvider();

    const synthesisEngine = new EvidenceSynthesisEngine({
      llmProvider,
    });

    const investigationManager = new InvestigationManager();

    const orchestrator = new InvestigationOrchestrator({
      planner,
      executor,
      synthesizer: synthesisEngine,
      investigationManager,
      capabilityRegistry: registry,
    });

    const ethToken: TokenContext = {
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'ETH',
      name: 'Ethereum',
      chain: 'ethereum',
      decimals: 18,
      resolvedAt: new Date().toISOString(),
    };

    const turn = await orchestrator.executeTurn({
      userId: 'live_test_user',
      question: "What's happening?",
      token: ethToken,
    });

    expect(turn.status).toBe('completed');
    expect(turn.evidence.length).toBeGreaterThan(0);
    expect(turn.synthesis).toBeDefined();
    expect(turn.synthesis?.answer.length).toBeGreaterThan(0);
    expect(turn.synthesis?.observations.length).toBeGreaterThan(0);
    expect(turn.synthesis?.evidenceRefs.length).toBeGreaterThan(0);
  }, 30000);
});
