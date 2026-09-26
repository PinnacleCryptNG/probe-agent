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
import { TokenResolver } from '../src/core/token/resolver.js';
import { formatInvestigationResult } from '../src/adapters/telegram/formatter.js';
import { TokenContext } from '../src/types/domain.js';
import { createLLMProvider } from '../src/core/llm/factory.js';
import { getEnv } from '../src/config/env.js';

interface TurnValidationResult {
  input: string;
  tokenSymbol: string;
  tokenAddress: string;
  chain: string;
  intent: string;
  selectedCapabilities: string[];
  plannedCapabilities: string[];
  endpointsCalled: string[];
  creditCost: number;
  remainingCredits: number;
  evidenceCount: number;
  evidenceItems: Array<{ id: string; capability: string; summary: string }>;
  evidenceRefs: string[];
  observationsCount: number;
  hasCausalViolation: boolean;
  unsupportedClaimsCount: number;
  turnStatus: string;
  isGrounded: boolean;
  clarificationRequired: boolean;
  formattedTelegramResponse: string;
  errors: string[];
}

const CAUSAL_PATTERNS = [
  /\bcaused by\b/i,
  /\bproves why\b/i,
  /\bpumped because\b/i,
  /\bdumped because\b/i,
  /\bdue to news\b/i,
  /\bdue to twitter\b/i,
  /\bdue to announcement\b/i,
  /\bthe reason for the pump\b/i,
  /\bthe reason for the dump\b/i,
];

async function runValidation() {
  const env = getEnv();
  console.log('=== PROBE PHASE 4A — REAL INVESTIGATION VALIDATION ===');
  console.log(`Nansen Base URL: ${env.NANSEN_BASE_URL}`);
  console.log(`LLM Provider: ${env.LLM_PROVIDER}`);

  // Create shared services
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

  const tokenResolver = new TokenResolver({
    nansenClient,
    cache,
  });

  // Track all HTTP calls made
  const originalFetch = globalThis.fetch;
  const recordedEndpoints: string[] = [];
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes('/api/v1/')) {
      const endpoint = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      recordedEndpoints.push(endpoint);
    }
    return originalFetch(input, init);
  };

  // Known good tokens
  const testTokens: TokenContext[] = [
    {
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'ETH',
      name: 'Ethereum',
      chain: 'ethereum',
      resolvedAt: new Date().toISOString(),
    },
    {
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      symbol: 'BONK',
      name: 'Bonk',
      chain: 'solana',
      resolvedAt: new Date().toISOString(),
    },
  ];

  const testIntents = [
    "What's happening?",
    "Who is buying?",
    "Who is selling?",
    "Biggest transactions",
    "Are whales accumulating?",
    "Are smart money wallets accumulating?",
    "What changed recently?",
    "Show me the largest buyers.",
    "Show me the largest sellers."
  ];

  const results: TurnValidationResult[] = [];

  for (const token of testTokens) {
    console.log(`\n======================================================`);
    console.log(`TESTING TOKEN: ${token.symbol} (${token.chain})`);
    console.log(`Address: ${token.address}`);
    console.log(`======================================================`);

    for (const question of testIntents) {
      console.log(`\n--- Intent: "${question}" on ${token.symbol} ---`);
      const endpointsBefore = recordedEndpoints.length;
      const spentBefore = creditManager.getSpentBudget();

      // Create a fresh investigation for isolated testing of each intent
      const inv = manager.createInvestigation({
        telegramChatId: `test_${token.symbol}_${Date.now()}`,
        token,
        initialQuestion: question,
      });

      const turn = await orchestrator.executeTurn({
        investigationId: inv.id,
        chatId: inv.telegramChatId,
        question,
        token,
        userId: 'test_user',
        remainingCredits: creditManager.getRemainingBudget(),
        maxCallsAllowed: env.CREDIT_MAX_CALLS_PER_TURN,
      });

      const spentAfter = creditManager.getSpentBudget();
      const turnEndpoints = recordedEndpoints.slice(endpointsBefore);
      const creditCost = spentAfter - spentBefore;

      const formatted = formatInvestigationResult(turn);

      // Verify causal violations
      let hasCausalViolation = false;
      if (turn.synthesis) {
        for (const obs of turn.synthesis.observations) {
          if (CAUSAL_PATTERNS.some((p) => p.test(obs.statement))) {
            hasCausalViolation = true;
          }
        }
        for (const interp of turn.synthesis.interpretations) {
          if (CAUSAL_PATTERNS.some((p) => p.test(interp.statement))) {
            hasCausalViolation = true;
          }
        }
      }

      // Verify evidence references
      const evidenceIds = new Set(turn.evidence.map((e) => e.evidenceId));
      let unsupportedClaimsCount = 0;
      if (turn.synthesis) {
        for (const obs of turn.synthesis.observations) {
          for (const ref of obs.evidenceRefs) {
            if (!evidenceIds.has(ref)) {
              unsupportedClaimsCount++;
            }
          }
        }
      }

      const isGrounded =
        turn.status !== 'failed' &&
        !hasCausalViolation &&
        unsupportedClaimsCount === 0 &&
        (turn.synthesis ? turn.synthesis.validated : true);

      const resItem: TurnValidationResult = {
        input: question,
        tokenSymbol: token.symbol,
        tokenAddress: token.address,
        chain: token.chain,
        intent: turn.plan?.intent ?? 'unknown',
        selectedCapabilities: turn.plan?.selectedCapabilities ?? [],
        plannedCapabilities: turn.plan?.plannedCapabilities.map((p) => p.name) ?? [],
        endpointsCalled: turnEndpoints,
        creditCost,
        remainingCredits: creditManager.getRemainingBudget(),
        evidenceCount: turn.evidence.length,
        evidenceItems: turn.evidence.map((e) => ({
          id: e.evidenceId,
          capability: e.provenance.capability,
          summary: e.summary,
        })),
        evidenceRefs: turn.synthesis?.evidenceRefs ?? [],
        observationsCount: turn.synthesis?.observations.length ?? 0,
        hasCausalViolation,
        unsupportedClaimsCount,
        turnStatus: turn.status,
        isGrounded,
        clarificationRequired: turn.status === 'needs_clarification',
        formattedTelegramResponse: formatted,
        errors: turn.error ? [turn.error.message] : [],
      };

      results.push(resItem);

      console.log(`  Intent: ${resItem.intent}`);
      console.log(`  Status: ${resItem.turnStatus}`);
      console.log(`  Capabilities Planned: ${resItem.plannedCapabilities.join(', ')}`);
      console.log(`  Endpoints Called: ${turnEndpoints.join(', ') || '(cached)'}`);
      console.log(`  Credit Cost: ${creditCost} (Remaining: ${resItem.remainingCredits})`);
      console.log(`  Evidence Items: ${resItem.evidenceCount}`);
      console.log(`  Observations: ${resItem.observationsCount}`);
      console.log(`  Grounded: ${isGrounded ? 'YES' : 'NO'}`);
      console.log(`  Clarification Needed: ${resItem.clarificationRequired ? 'YES' : 'NO'}`);
      if (resItem.errors.length > 0) {
        console.log(`  Errors: ${resItem.errors.join('; ')}`);
      }
    }
  }

  // Conversational Follow-up Test
  console.log(`\n======================================================`);
  console.log(`CONVERSATIONAL FOLLOW-UP TEST: BONK`);
  console.log(`BONK -> What's happening? -> Who is buying? -> Are they whales? -> Why?`);
  console.log(`======================================================`);

  const bonkToken = testTokens[1];
  const convChatId = `conv_bonk_${Date.now()}`;
  const convInv = manager.createInvestigation({
    telegramChatId: convChatId,
    token: bonkToken,
  });

  const convQuestions = [
    "What's happening?",
    "Who is buying?",
    "Are they whales?",
    "Why?"
  ];

  const convResults: TurnValidationResult[] = [];

  for (const q of convQuestions) {
    console.log(`\nFollow-up Step: "${q}"`);
    const endpointsBefore = recordedEndpoints.length;
    const spentBefore = creditManager.getSpentBudget();

    const turn = await orchestrator.executeTurn({
      investigationId: convInv.id,
      chatId: convChatId,
      question: q,
      token: bonkToken,
      userId: 'test_user',
      remainingCredits: creditManager.getRemainingBudget(),
      maxCallsAllowed: env.CREDIT_MAX_CALLS_PER_TURN,
    });

    const spentAfter = creditManager.getSpentBudget();
    const turnEndpoints = recordedEndpoints.slice(endpointsBefore);
    const creditCost = spentAfter - spentBefore;
    const formatted = formatInvestigationResult(turn);

    const resItem: TurnValidationResult = {
      input: q,
      tokenSymbol: bonkToken.symbol,
      tokenAddress: bonkToken.address,
      chain: bonkToken.chain,
      intent: turn.plan?.intent ?? 'unknown',
      selectedCapabilities: turn.plan?.selectedCapabilities ?? [],
      plannedCapabilities: turn.plan?.plannedCapabilities.map((p) => p.name) ?? [],
      endpointsCalled: turnEndpoints,
      creditCost,
      remainingCredits: creditManager.getRemainingBudget(),
      evidenceCount: turn.evidence.length,
      evidenceItems: turn.evidence.map((e) => ({
        id: e.evidenceId,
        capability: e.provenance.capability,
        summary: e.summary,
      })),
      evidenceRefs: turn.synthesis?.evidenceRefs ?? [],
      observationsCount: turn.synthesis?.observations.length ?? 0,
      hasCausalViolation: false,
      unsupportedClaimsCount: 0,
      turnStatus: turn.status,
      isGrounded: turn.status !== 'failed' && (turn.synthesis ? turn.synthesis.validated : true),
      clarificationRequired: turn.status === 'needs_clarification',
      formattedTelegramResponse: formatted,
      errors: turn.error ? [turn.error.message] : [],
    };

    convResults.push(resItem);

    console.log(`  Token Context Maintained: ${convInv.token.symbol} (${convInv.token.chain})`);
    console.log(`  Intent: ${resItem.intent}`);
    console.log(`  Status: ${resItem.turnStatus}`);
    console.log(`  Capabilities Planned: ${resItem.plannedCapabilities.join(', ')}`);
    console.log(`  Endpoints: ${turnEndpoints.join(', ') || '(cached)'}`);
    console.log(`  Cost: ${creditCost} (Remaining: ${resItem.remainingCredits})`);
    console.log(`  Evidence Count: ${resItem.evidenceCount}`);
    console.log(`  Clarification Needed: ${resItem.clarificationRequired ? 'YES' : 'NO'}`);
  }

  // Summary analysis
  console.log(`\n======================================================`);
  console.log(`VALIDATION SUMMARY REPORT`);
  console.log(`======================================================`);
  console.log(`Total Turns Executed: ${results.length + convResults.length}`);
  console.log(`Total Credits Spent: ${creditManager.getSpentBudget()}`);
  console.log(`Remaining Budget: ${creditManager.getRemainingBudget()}`);

  const failures = [...results, ...convResults].filter((r) => r.turnStatus === 'failed' || r.clarificationRequired);
  console.log(`\nTurns requiring clarification or failing: ${failures.length}`);
  for (const f of failures) {
    console.log(`  - Token: ${f.tokenSymbol}, Input: "${f.input}", Status: ${f.turnStatus}, Intent: ${f.intent}`);
  }

  // Write full results to JSON for precise reporting
  const fs = await import('node:fs');
  fs.writeFileSync('scripts/validation-results.json', JSON.stringify({ results, convResults }, null, 2));
  console.log('Detailed results written to scripts/validation-results.json');
}

runValidation().catch((err) => {
  console.error('Validation script failed:', err);
  process.exit(1);
});
