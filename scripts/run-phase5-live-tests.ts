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

interface TurnSummary {
  turnNumber: number;
  question: string;
  isChallenge: boolean;
  challengeCategory?: string;
  verdict?: string;
  evidenceReusedCount: number;
  newNansenCalls: number;
  creditsConsumed: number;
  telegramOutput: string;
}

async function runLiveTests() {
  const env = getEnv();
  console.log('=== PROBE PHASE 5 — CHALLENGE MODE LIVE VALIDATION ===\n');

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

  const allTurnSummaries: { asset: string; turns: TurnSummary[] }[] = [];

  // ==========================================
  // SEQUENCE 1: ETH
  // ==========================================
  console.log('--------------------------------------------------');
  console.log('STARTING ETH CONVERSATIONAL SEQUENCE');
  console.log('--------------------------------------------------');

  const ethChatId = 88801;
  const ethQuestions = [
    'Are whales accumulating?',
    'Are you sure?',
    'What evidence supports that?',
    'Could there be another explanation?',
    'What would disprove it?',
  ];

  const ethInv = manager.createInvestigation({
    telegramChatId: ethChatId,
    token: ethToken,
    initialQuestion: ethQuestions[0],
  });

  const ethTurnSummaries: TurnSummary[] = [];

  for (let i = 0; i < ethQuestions.length; i++) {
    const q = ethQuestions[i];
    console.log(`\n[ETH Turn ${i + 1}] User: "${q}"`);

    const creditsBefore = creditManager.getRemainingBudget();
    const turnResult = await orchestrator.executeTurn({
      investigationId: ethInv.id,
      chatId: ethChatId,
      question: q,
      token: ethToken,
      userId: 'phase5_live_tester',
    });
    const creditsAfter = creditManager.getRemainingBudget();
    const creditsSpent = creditsBefore - creditsAfter;

    const telegramText = formatInvestigationResult(turnResult);

    const summary: TurnSummary = {
      turnNumber: i + 1,
      question: q,
      isChallenge: !!turnResult.challenge,
      challengeCategory: turnResult.challenge ? (orchestrator as any).challengeSynthesizer ? 'DETECTED' : undefined : undefined,
      verdict: turnResult.challenge?.verdict,
      evidenceReusedCount: turnResult.evidence.length,
      newNansenCalls: turnResult.challenge ? 0 : turnResult.evidence.length,
      creditsConsumed: creditsSpent,
      telegramOutput: telegramText,
    };

    ethTurnSummaries.push(summary);

    console.log(`> Challenge Detected: ${summary.isChallenge}`);
    if (turnResult.challenge) {
      console.log(`> Challenge Verdict: ${turnResult.challenge.verdict}`);
    }
    console.log(`> Evidence Count: ${summary.evidenceReusedCount}`);
    console.log(`> Credits Consumed: ${summary.creditsConsumed}`);
    console.log(`> Response Preview:\n${telegramText}\n`);
  }

  allTurnSummaries.push({ asset: 'ETH', turns: ethTurnSummaries });

  // ==========================================
  // SEQUENCE 2: BONK
  // ==========================================
  console.log('--------------------------------------------------');
  console.log('STARTING BONK CONVERSATIONAL SEQUENCE');
  console.log('--------------------------------------------------');

  const bonkChatId = 88802;
  const bonkQuestions = [
    'Are whales accumulating?',
    'Prove it.',
    'Could the whale activity just be internal wallet movement?',
  ];

  const bonkInv = manager.createInvestigation({
    telegramChatId: bonkChatId,
    token: bonkToken,
    initialQuestion: bonkQuestions[0],
  });

  const bonkTurnSummaries: TurnSummary[] = [];

  for (let i = 0; i < bonkQuestions.length; i++) {
    const q = bonkQuestions[i];
    console.log(`\n[BONK Turn ${i + 1}] User: "${q}"`);

    const creditsBefore = creditManager.getRemainingBudget();
    const turnResult = await orchestrator.executeTurn({
      investigationId: bonkInv.id,
      chatId: bonkChatId,
      question: q,
      token: bonkToken,
      userId: 'phase5_live_tester',
    });
    const creditsAfter = creditManager.getRemainingBudget();
    const creditsSpent = creditsBefore - creditsAfter;

    const telegramText = formatInvestigationResult(turnResult);

    const summary: TurnSummary = {
      turnNumber: i + 1,
      question: q,
      isChallenge: !!turnResult.challenge,
      verdict: turnResult.challenge?.verdict,
      evidenceReusedCount: turnResult.evidence.length,
      newNansenCalls: turnResult.challenge ? 0 : turnResult.evidence.length,
      creditsConsumed: creditsSpent,
      telegramOutput: telegramText,
    };

    bonkTurnSummaries.push(summary);

    console.log(`> Challenge Detected: ${summary.isChallenge}`);
    if (turnResult.challenge) {
      console.log(`> Challenge Verdict: ${turnResult.challenge.verdict}`);
    }
    console.log(`> Evidence Count: ${summary.evidenceReusedCount}`);
    console.log(`> Credits Consumed: ${summary.creditsConsumed}`);
    console.log(`> Response Preview:\n${telegramText}\n`);
  }

  allTurnSummaries.push({ asset: 'BONK', turns: bonkTurnSummaries });

  console.log('=== COMPLETE PHASE 5 SUMMARY JSON ===');
  console.log(JSON.stringify(allTurnSummaries, null, 2));
}

runLiveTests().catch((err) => {
  console.error('Phase 5 live test failed:', err);
  process.exit(1);
});
