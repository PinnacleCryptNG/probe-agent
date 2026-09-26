import dotenv from 'dotenv';
dotenv.config();

import { capabilityRegistry } from '../src/core/capabilities/registry.js';
import { CreditBudgetManager } from '../src/core/credit/budget-manager.js';
import { MemoryCache } from '../src/core/cache/memory-cache.js';
import { NansenClient } from '../src/core/nansen/client.js';
import { EvidenceExecutor } from '../src/core/evidence/executor.js';
import { InvestigationPlanner } from '../src/core/planner/planner.js';
import { EvidenceSynthesisEngine } from '../src/core/synthesis/synthesizer.js';
import { InvestigationManager } from '../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../src/core/investigation/orchestrator.js';
import { formatInvestigationResult } from '../src/adapters/telegram/formatter.js';
import { createLLMProvider } from '../src/core/llm/factory.js';
import { getEnv } from '../src/config/env.js';
import { TokenContext } from '../src/types/token.js';

async function runLiveTests() {
  const env = getEnv();
  console.log('=== PROBE PHASE 4C — EPISTEMIC HARDENING LIVE INVESTIGATIONS ===\n');

  const cache = new MemoryCache(env.CACHE_TTL_SECONDS);
  const creditManager = new CreditBudgetManager({
    totalBudget: env.CREDIT_BUDGET_TOTAL,
    maxCallsPerTurn: env.CREDIT_MAX_CALLS_PER_TURN,
  });

  const nansenClient = new NansenClient({
    apiKey: env.NANSEN_API_KEY,
    baseUrl: env.NANSEN_BASE_URL,
  });

  const llmProvider = createLLMProvider(env);
  const executor = new EvidenceExecutor({
    capabilityRegistry,
    nansenClient,
    creditManager,
    cache,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  });

  const planner = new InvestigationPlanner({
    capabilityRegistry,
    llmProvider,
  });

  const synthesizer = new EvidenceSynthesisEngine({
    llmProvider,
  });

  const manager = new InvestigationManager();
  const orchestrator = new InvestigationOrchestrator({
    planner,
    executor,
    synthesizer,
    investigationManager: manager,
  });

  const ethToken: TokenContext = {
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    resolvedAt: new Date().toISOString(),
  };

  const bonkToken: TokenContext = {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    chain: 'solana',
    resolvedAt: new Date().toISOString(),
  };

  const testCases = [
    { name: 'Investigation 1: ETH — Who is buying?', token: ethToken, question: 'Who is buying?' },
    { name: 'Investigation 2: ETH — Are whales accumulating?', token: ethToken, question: 'Are whales accumulating?' },
    { name: 'Investigation 3: ETH — Who is selling?', token: ethToken, question: 'Who is selling?' },
    { name: 'Investigation 4: BONK — Are whales accumulating?', token: bonkToken, question: 'Are whales accumulating?' },
    { name: 'Investigation 5: BONK — Who is buying?', token: bonkToken, question: 'Who is buying?' },
  ];

  for (const tc of testCases) {
    console.log(`\n==================================================`);
    console.log(`RUNNING ${tc.name}`);
    console.log(`==================================================`);
    const inv = manager.createInvestigation({
      telegramChatId: 99999,
      token: tc.token,
      initialQuestion: tc.question,
    });

    const creditsBefore = creditManager.getRemainingBudget();
    const turnResult = await orchestrator.executeTurn({
      investigationId: inv.id,
      chatId: 99999,
      question: tc.question,
      token: tc.token,
      userId: 'test_user_4c',
    });
    const creditsAfter = creditManager.getRemainingBudget();
    const cost = creditsBefore - creditsAfter;

    const formattedTelegram = formatInvestigationResult(turnResult);

    console.log('\n--- EXACT RESULTING TELEGRAM TEXT ---');
    console.log(formattedTelegram);
    console.log('------------------------------------');
    console.log(`Status: ${turnResult.status}`);
    console.log(`Credits consumed: ${cost}`);
    console.log(`Credits remaining: ${creditsAfter}`);
  }

  console.log('\n=== ALL PHASE 4C LIVE TESTS COMPLETED ===');
}

runLiveTests().catch((err) => {
  console.error('Live testing failed:', err);
  process.exit(1);
});
