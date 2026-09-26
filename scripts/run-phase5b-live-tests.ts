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

interface TurnSummary5B {
  turnNumber: number;
  question: string;
  isChallenge: boolean;
  evidenceStatus?: string;
  interpretationStatus?: string;
  verdict?: string;
  proposedAlternative?: string;
  falsificationCriteriaCount?: number;
  evidenceReusedCount: number;
  newNansenCalls: number;
  creditsConsumed: number;
  telegramOutput: string;
}

async function runLiveTests() {
  const env = getEnv();
  console.log('=== PROBE PHASE 5B — CHALLENGE QUALITY HARDENING LIVE VALIDATION ===\n');

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

  const allTurnSummaries: { asset: string; turns: TurnSummary5B[] }[] = [];

  // ==========================================
  // SEQUENCE 1: ETH
  // 1. "Are whales accumulating?"
  // 2. "Are you sure?"
  // 3. "What would actually confirm selling?"
  // ==========================================
  console.log('--------------------------------------------------');
  console.log('STARTING ETH CONVERSATIONAL SEQUENCE (PHASE 5B)');
  console.log('--------------------------------------------------');

  const ethChatId = 88811;
  const ethQuestions = [
    'Are whales accumulating?',
    'Are you sure?',
    'What would actually confirm selling?',
  ];

  const ethInv = manager.createInvestigation({
    telegramChatId: ethChatId,
    token: ethToken,
    initialQuestion: ethQuestions[0],
  });

  const ethTurnSummaries: TurnSummary5B[] = [];

  for (let i = 0; i < ethQuestions.length; i++) {
    const q = ethQuestions[i];
    console.log(`\n[ETH Turn ${i + 1}] User: "${q}"`);

    const creditsBefore = creditManager.getRemainingBudget();
    const turnResult = await orchestrator.executeTurn({
      investigationId: ethInv.id,
      chatId: ethChatId,
      question: q,
      token: ethToken,
      userId: 'phase5b_live_tester',
    });
    const creditsAfter = creditManager.getRemainingBudget();
    const creditsSpent = creditsBefore - creditsAfter;

    const telegramText = formatInvestigationResult(turnResult);

    const summary: TurnSummary5B = {
      turnNumber: i + 1,
      question: q,
      isChallenge: !!turnResult.challenge,
      evidenceStatus: turnResult.challenge?.evidenceStatus,
      interpretationStatus: turnResult.challenge?.interpretationStatus,
      verdict: turnResult.challenge?.verdict,
      proposedAlternative: turnResult.challenge?.proposedAlternative,
      falsificationCriteriaCount: turnResult.challenge?.discriminatingCriteria?.length,
      evidenceReusedCount: turnResult.evidence.length,
      newNansenCalls: turnResult.challenge ? 0 : turnResult.evidence.length,
      creditsConsumed: creditsSpent,
      telegramOutput: telegramText,
    };

    ethTurnSummaries.push(summary);

    console.log(`> Challenge Detected: ${summary.isChallenge}`);
    if (turnResult.challenge) {
      console.log(`> Evidence Status: ${summary.evidenceStatus}`);
      console.log(`> Interpretation Status: ${summary.interpretationStatus}`);
      console.log(`> Verdict: ${summary.verdict}`);
      if (summary.falsificationCriteriaCount) {
        console.log(`> Discriminating Criteria Categories: ${summary.falsificationCriteriaCount}`);
      }
    }
    console.log(`> Evidence Count: ${summary.evidenceReusedCount}`);
    console.log(`> Credits Consumed: ${summary.creditsConsumed}`);
    console.log(`> Response Preview:\n${telegramText}\n`);
  }

  allTurnSummaries.push({ asset: 'ETH', turns: ethTurnSummaries });

  // ==========================================
  // SEQUENCE 2: BONK
  // 1. "Are whales accumulating?"
  // 2. "Could the whale activity just be internal wallet movement?"
  // ==========================================
  console.log('--------------------------------------------------');
  console.log('STARTING BONK CONVERSATIONAL SEQUENCE (PHASE 5B)');
  console.log('--------------------------------------------------');

  const bonkChatId = 88812;
  const bonkQuestions = [
    'Are whales accumulating?',
    'Could the whale activity just be internal wallet movement?',
  ];

  const bonkInv = manager.createInvestigation({
    telegramChatId: bonkChatId,
    token: bonkToken,
    initialQuestion: bonkQuestions[0],
  });

  const bonkTurnSummaries: TurnSummary5B[] = [];

  for (let i = 0; i < bonkQuestions.length; i++) {
    const q = bonkQuestions[i];
    console.log(`\n[BONK Turn ${i + 1}] User: "${q}"`);

    const creditsBefore = creditManager.getRemainingBudget();
    const turnResult = await orchestrator.executeTurn({
      investigationId: bonkInv.id,
      chatId: bonkChatId,
      question: q,
      token: bonkToken,
      userId: 'phase5b_live_tester',
    });
    const creditsAfter = creditManager.getRemainingBudget();
    const creditsSpent = creditsBefore - creditsAfter;

    const telegramText = formatInvestigationResult(turnResult);

    const summary: TurnSummary5B = {
      turnNumber: i + 1,
      question: q,
      isChallenge: !!turnResult.challenge,
      evidenceStatus: turnResult.challenge?.evidenceStatus,
      interpretationStatus: turnResult.challenge?.interpretationStatus,
      verdict: turnResult.challenge?.verdict,
      proposedAlternative: turnResult.challenge?.proposedAlternative,
      falsificationCriteriaCount: turnResult.challenge?.discriminatingCriteria?.length,
      evidenceReusedCount: turnResult.evidence.length,
      newNansenCalls: turnResult.challenge ? 0 : turnResult.evidence.length,
      creditsConsumed: creditsSpent,
      telegramOutput: telegramText,
    };

    bonkTurnSummaries.push(summary);

    console.log(`> Challenge Detected: ${summary.isChallenge}`);
    if (turnResult.challenge) {
      console.log(`> Evidence Status: ${summary.evidenceStatus}`);
      console.log(`> Interpretation Status: ${summary.interpretationStatus}`);
      console.log(`> Verdict: ${summary.verdict}`);
      if (summary.proposedAlternative) {
        console.log(`> Proposed Alternative: ${summary.proposedAlternative}`);
      }
    }
    console.log(`> Evidence Count: ${summary.evidenceReusedCount}`);
    console.log(`> Credits Consumed: ${summary.creditsConsumed}`);
    console.log(`> Response Preview:\n${telegramText}\n`);
  }

  allTurnSummaries.push({ asset: 'BONK', turns: bonkTurnSummaries });

  console.log('=== COMPLETE PHASE 5B SUMMARY JSON ===');
  console.log(JSON.stringify(allTurnSummaries, null, 2));
}

runLiveTests().catch((err) => {
  console.error('Phase 5B live test failed:', err);
  process.exit(1);
});
