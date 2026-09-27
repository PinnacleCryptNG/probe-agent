import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import {
  TokenTarget,
  ChainTarget,
} from '../../../src/core/target/types.js';
import { ITokenResolver, TokenCandidate, TokenResolutionResult } from '../../../src/core/token/types.js';
import { TokenContext } from '../../../src/types/domain.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { isFuturePricePrediction } from '../../../src/core/planner/prediction.js';
import { PROBE_CONSTANTS } from '../../../src/config/constants.js';
import {
  getNativeAssetForChain,
  isNativeAssetTicker,
} from '../../../src/core/target/native-assets.js';
import { EvidenceItem } from '../../../src/types/evidence.js';

describe('PROBE On-Chain Investigation Desk Matrix', () => {
  const mockBtcToken: TokenContext = {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'ethereum',
    priceUsd: 65000,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockEthToken: TokenContext = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    priceUsd: 3000,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockSolToken: TokenContext = {
    address: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    priceUsd: 150,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockHyperToken: TokenContext = {
    address: '0x9999999999999999999999999999999999999999',
    symbol: 'HYPER',
    name: 'Hyper Liquid Community Token',
    chain: 'arbitrum',
    priceUsd: 1.25,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockPepeToken: TokenContext = {
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    name: 'Pepe',
    chain: 'ethereum',
    priceUsd: 0.00001,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockUsdcToken: TokenContext = {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'ethereum',
    priceUsd: 1.0,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const activeEthTarget: TokenTarget = {
    type: 'token',
    token: mockEthToken,
    chain: 'ethereum',
    rawIdentifier: 'ETH',
  };

  const createMockTokenResolver = (): ITokenResolver => ({
    resolve: vi.fn().mockImplementation(async (candidateOrQuery: TokenCandidate | string): Promise<TokenContext | null> => {
      const raw = typeof candidateOrQuery === 'string'
        ? candidateOrQuery
        : ((candidateOrQuery as any)?.identifier ?? candidateOrQuery?.symbol ?? (candidateOrQuery as any)?.rawInput ?? '');
      const query = (raw ? String(raw) : '').toUpperCase().replace(/^\$/, '');

      if (query === 'BTC' || query === 'BITCOIN') {
        return mockBtcToken;
      }
      if (query === 'ETH' || query === 'ETHEREUM') {
        return mockEthToken;
      }
      if (query === 'SOL' || query === 'SOLANA') {
        return mockSolToken;
      }
      if (query === 'HYPER') {
        return mockHyperToken;
      }
      if (query === 'PEPE') {
        return mockPepeToken;
      }
      if (query === 'USDC') {
        return mockUsdcToken;
      }

      return null;
    }),
    resolveDetailed: vi.fn().mockImplementation(async (candidateOrQuery: TokenCandidate | string): Promise<TokenResolutionResult> => {
      const raw = typeof candidateOrQuery === 'string'
        ? candidateOrQuery
        : ((candidateOrQuery as any)?.identifier ?? candidateOrQuery?.symbol ?? (candidateOrQuery as any)?.rawInput ?? '');
      const query = (raw ? String(raw) : '').toUpperCase().replace(/^\$/, '');

      let token: TokenContext | undefined;
      if (query === 'BTC' || query === 'BITCOIN') token = mockBtcToken;
      if (query === 'ETH' || query === 'ETHEREUM') token = mockEthToken;
      if (query === 'SOL' || query === 'SOLANA') token = mockSolToken;
      if (query === 'HYPER') token = mockHyperToken;
      if (query === 'PEPE') token = mockPepeToken;
      if (query === 'USDC') token = mockUsdcToken;

      if (token) {
        return {
          status: 'RESOLVED',
          token,
          detectedChain: token.chain,
          creditCost: 0,
        };
      }
      return {
        status: 'NOT_FOUND',
        creditCost: 0,
      };
    }),
  });

  let targetResolver: TargetResolver;
  let planner: InvestigationPlanner;

  beforeEach(() => {
    targetResolver = new TargetResolver(createMockTokenResolver());
    planner = new InvestigationPlanner();
  });

  // ==================================================
  // 1. CHAIN-FIRST INVESTIGATION
  // ==================================================
  describe('1. Chain-First Investigation Matrix', () => {
    it('"What\'s happening on Ethereum?" resolves to chain Ethereum and activity_change intent', async () => {
      const q = "What's happening on Ethereum?";
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('ethereum');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('activity_change');
      expect(plan.selectedCapabilities.length).toBeGreaterThan(0);
    });

    it('"Who are the biggest whales on Ethereum?" resolves to chain Ethereum and flow_analysis intent', async () => {
      const q = 'Who are the biggest whales on Ethereum?';
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('ethereum');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('flow_analysis');
      expect(plan.unresolvedRequirements).toHaveLength(0);
    });

    it('"What is smart money doing on Solana?" resolves to chain Solana and flow_analysis intent', async () => {
      const q = 'What is smart money doing on Solana?';
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('solana');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('flow_analysis');
      expect(plan.unresolvedRequirements).toHaveLength(0);
    });

    it('"What\'s moving on Base?" resolves to chain Base and activity_change intent', async () => {
      const q = "What's moving on Base?";
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('base');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('activity_change');
      expect(plan.selectedCapabilities.length).toBeGreaterThan(0);
    });

    it('"What changed on Hyperliquid?" resolves to chain Hyperliquid and activity_change intent', async () => {
      const q = 'What changed on Hyperliquid?';
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('hyperliquid');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('activity_change');
      expect(plan.selectedCapabilities.length).toBeGreaterThan(0);
    });

    it('"Show me the biggest transactions on Aptos." resolves to chain Aptos and large_transactions intent', async () => {
      const q = 'Show me the biggest transactions on Aptos.';
      const res = await targetResolver.resolve({ question: q });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('aptos');

      const plan = await planner.plan({ target: res.target }, q);
      expect(plan.intent).toBe('large_transactions');
      expect(plan.warnings.some((w) => w.code === 'CHAIN_UNSUPPORTED')).toBe(true);
    });
  });

  // ==================================================
  // 2. NATIVE CHAIN ASSET / TICKER RESOLUTION
  // ==================================================
  describe('2. Native Chain Asset / Ticker Resolution Matrix', () => {
    it('verifies registry maps supported chains from constants', () => {
      for (const chain of PROBE_CONSTANTS.SUPPORTED_EVM_CHAINS) {
        const asset = getNativeAssetForChain(chain);
        expect(asset).toBeDefined();
        expect(asset?.ticker).toBeDefined();
      }
      for (const chain of PROBE_CONSTANTS.SUPPORTED_NON_EVM_CHAINS) {
        const asset = getNativeAssetForChain(chain);
        expect(asset).toBeDefined();
        expect(asset?.ticker).toBeDefined();
      }
      expect(isNativeAssetTicker('ETH')).toBe(true);
      expect(isNativeAssetTicker('SOL')).toBe(true);
      expect(isNativeAssetTicker('APT')).toBe(true);
      expect(isNativeAssetTicker('HYPE')).toBe(true);
    });

    it('resolves ETH and $ETH to native Ethereum asset without asking "Which chain?"', async () => {
      const res1 = await targetResolver.resolve({ question: 'ETH' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('ETH');
      expect(res1.target.chain).toBe('ethereum');

      const res2 = await targetResolver.resolve({ question: '$ETH' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('ETH');
      expect(res2.target.chain).toBe('ethereum');
    });

    it('resolves SOL and $SOL to native Solana asset without asking "Which chain?"', async () => {
      const res1 = await targetResolver.resolve({ question: 'SOL' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('SOL');
      expect(res1.target.chain).toBe('solana');

      const res2 = await targetResolver.resolve({ question: '$SOL' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('SOL');
      expect(res2.target.chain).toBe('solana');
    });

    it('resolves APT and $APT to native Aptos asset without asking "Which chain?"', async () => {
      const res1 = await targetResolver.resolve({ question: 'APT' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('APT');
      expect(res1.target.chain).toBe('aptos');

      const res2 = await targetResolver.resolve({ question: '$APT' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('APT');
      expect(res2.target.chain).toBe('aptos');
    });

    it('resolves HYPE and $HYPE to native Hyperliquid asset without asking "Which chain?"', async () => {
      const res1 = await targetResolver.resolve({ question: 'HYPE' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('HYPE');
      expect(res1.target.chain).toBe('hyperliquid');

      const res2 = await targetResolver.resolve({ question: '$HYPE' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('HYPE');
      expect(res2.target.chain).toBe('hyperliquid');
    });
  });

  // ==================================================
  // 3. CASHTAGS GENERAL PIPELINE
  // ==================================================
  describe('3. General Cashtags Pipeline Matrix', () => {
    it('normalizes and resolves $BTC, $PEPE, $USDC through asset pipeline', async () => {
      const btcRes = await targetResolver.resolve({ question: '$BTC' });
      expect(btcRes.status).toBe('RESOLVED');
      expect((btcRes.target as TokenTarget).token.symbol).toBe('BTC');

      const pepeRes = await targetResolver.resolve({ question: '$PEPE' });
      expect(pepeRes.status).toBe('RESOLVED');
      expect((pepeRes.target as TokenTarget).token.symbol).toBe('PEPE');

      const usdcRes = await targetResolver.resolve({ question: '$USDC' });
      expect(usdcRes.status).toBe('RESOLVED');
      expect((usdcRes.target as TokenTarget).token.symbol).toBe('USDC');
    });
  });

  // ==================================================
  // 4. TOKEN VS CHAIN DISAMBIGUATION
  // ==================================================
  describe('4. Token vs Chain Disambiguation', () => {
    it('"ETH on Ethereum" resolves specified asset and chain', async () => {
      const res = await targetResolver.resolve({ question: 'ETH on Ethereum' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('ETH');
      expect(res.target.chain).toBe('ethereum');
    });

    it('"$BTC on Ethereum" resolves specified asset and chain', async () => {
      const res = await targetResolver.resolve({ question: '$BTC on Ethereum' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('BTC');
      expect(res.target.chain).toBe('ethereum');
    });

    it('"SOL on Solana" resolves specified asset and chain', async () => {
      const res = await targetResolver.resolve({ question: 'SOL on Solana' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('SOL');
      expect(res.target.chain).toBe('solana');
    });

    it('"What\'s happening on Ethereum?" resolves to the chain', async () => {
      const res = await targetResolver.resolve({ question: "What's happening on Ethereum?" });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('ethereum');
    });
  });

  // ==================================================
  // 5. CONTEXT PRECEDENCE MATRIX
  // ==================================================
  describe('5. Context Precedence Matrix (ETH active)', () => {
    it('ETH active -> "Who is buying?" stays on ETH', async () => {
      const res = await targetResolver.resolve({
        question: 'Who is buying?',
        existingTarget: activeEthTarget,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('ETH');
      expect(res.source).toBe('existing_context');

      const plan = await planner.plan({ target: res.target }, 'Who is buying?');
      expect(plan.intent).toBe('accumulation');
    });

    it('ETH active -> "What about BTC?" switches to BTC', async () => {
      const res = await targetResolver.resolve({
        question: 'What about BTC?',
        existingTarget: activeEthTarget,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('BTC');
      expect(res.source).toBe('explicit_message');
    });

    it('ETH active -> "What about $SOL?" switches to SOL', async () => {
      const res = await targetResolver.resolve({
        question: 'What about $SOL?',
        existingTarget: activeEthTarget,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      expect((res.target as TokenTarget).token.symbol).toBe('SOL');
      expect(res.source).toBe('explicit_message');
    });

    it('ETH active -> "What\'s happening on Solana?" switches to Solana chain', async () => {
      const res = await targetResolver.resolve({
        question: "What's happening on Solana?",
        existingTarget: activeEthTarget,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('solana');
      expect(res.source).toBe('explicit_message');
    });

    it('ETH active -> "Who are the biggest whales on Ethereum?" switches to Ethereum chain', async () => {
      const res = await targetResolver.resolve({
        question: 'Who are the biggest whales on Ethereum?',
        existingTarget: activeEthTarget,
      });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('chain');
      expect((res.target as ChainTarget).chain).toBe('ethereum');
      expect(res.source).toBe('explicit_message');
    });
  });

  // ==================================================
  // 6. INTENT INDEPENDENCE MATRIX
  // ==================================================
  describe('6. Intent Independence Matrix', () => {
    it('"What were the biggest transactions this week?" -> large_transactions', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, 'What were the biggest transactions this week?');
      expect(plan.intent).toBe('large_transactions');
    });

    it('"Who is buying?" -> accumulation', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, 'Who is buying?');
      expect(plan.intent).toBe('accumulation');
    });

    it('"Who is selling?" -> distribution', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, 'Who is selling?');
      expect(plan.intent).toBe('distribution');
    });

    it('"What changed recently?" -> activity_change', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, 'What changed recently?');
      expect(plan.intent).toBe('activity_change');
    });

    it('"Who are the biggest whales?" -> flow_analysis', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, 'Who are the biggest whales?');
      expect(plan.intent).toBe('flow_analysis');
    });

    it('"What\'s happening?" -> activity_change', async () => {
      const plan = await planner.plan({ target: activeEthTarget }, "What's happening?");
      expect(plan.intent).toBe('activity_change');
    });
  });

  // ==================================================
  // 7. PREDICTION SEPARATION MATRIX
  // ==================================================
  describe('7. Prediction Separation Matrix', () => {
    it('"Will ETH pump tomorrow?" is recognized as future price prediction and rejected', async () => {
      expect(isFuturePricePrediction('Will ETH pump tomorrow?')).toBe(true);
      const plan = await planner.plan({ target: activeEthTarget }, 'Will ETH pump tomorrow?');
      expect(plan.intent).toBe('unknown');
    });

    it('"Will ETH hit $5,000?" is recognized as future price prediction and rejected', async () => {
      expect(isFuturePricePrediction('Will ETH hit $5,000?')).toBe(true);
      const plan = await planner.plan({ target: activeEthTarget }, 'Will ETH hit $5,000?');
      expect(plan.intent).toBe('unknown');
    });

    it('"Where will BTC price be next week?" is recognized as future price prediction and rejected', async () => {
      expect(isFuturePricePrediction('Where will BTC price be next week?')).toBe(true);
      const plan = await planner.plan({ target: activeEthTarget }, 'Where will BTC price be next week?');
      expect(plan.intent).toBe('unknown');
    });

    it('"Why is ETH moving?" is investigated as activity_change', async () => {
      expect(isFuturePricePrediction('Why is ETH moving?')).toBe(false);
      const plan = await planner.plan({ target: activeEthTarget }, 'Why is ETH moving?');
      expect(plan.intent).toBe('activity_change');
    });

    it('"Who is buying ETH?" is investigated as accumulation', async () => {
      expect(isFuturePricePrediction('Who is buying ETH?')).toBe(false);
      const plan = await planner.plan({ target: activeEthTarget }, 'Who is buying ETH?');
      expect(plan.intent).toBe('accumulation');
    });

    it('"What were the biggest ETH transactions?" is investigated as large_transactions', async () => {
      expect(isFuturePricePrediction('What were the biggest ETH transactions?')).toBe(false);
      const plan = await planner.plan({ target: activeEthTarget }, 'What were the biggest ETH transactions?');
      expect(plan.intent).toBe('large_transactions');
    });

    it('"Who are the biggest whales on Ethereum right now?" is investigated as flow_analysis', async () => {
      expect(isFuturePricePrediction('Who are the biggest whales on Ethereum right now?')).toBe(false);
      const chainTarget: ChainTarget = { type: 'chain', chain: 'ethereum', chainDisplayName: 'Ethereum' };
      const plan = await planner.plan({ target: chainTarget }, 'Who are the biggest whales on Ethereum right now?');
      expect(plan.intent).toBe('flow_analysis');
    });
  });

  // ==================================================
  // 9. HYPE / HYPER TEST CASES
  // ==================================================
  describe('9. HYPE / HYPER Test Cases', () => {
    it('HYPE and $HYPE resolve to Hyperliquid native asset', async () => {
      const hype = await targetResolver.resolve({ question: 'HYPE' });
      expect(hype.status).toBe('RESOLVED');
      expect(hype.target.type).toBe('token');
      expect((hype.target as TokenTarget).token.symbol).toBe('HYPE');
      expect(hype.target.chain).toBe('hyperliquid');

      const cashtagHype = await targetResolver.resolve({ question: '$HYPE' });
      expect(cashtagHype.status).toBe('RESOLVED');
      expect(cashtagHype.target.type).toBe('token');
      expect((cashtagHype.target as TokenTarget).token.symbol).toBe('HYPE');
      expect(cashtagHype.target.chain).toBe('hyperliquid');
    });

    it('$HYPER runs normal Nansen token search and does NOT force Hyperliquid chain', async () => {
      const hyper = await targetResolver.resolve({ question: '$HYPER' });
      expect(hyper.status).toBe('RESOLVED');
      expect(hyper.target.type).toBe('token');
      const token = (hyper.target as TokenTarget).token;
      expect(token.symbol).toBe('HYPER');
      expect(token.chain).toBe('arbitrum'); // from mock token search
      expect(token.name).toBe('Hyper Liquid Community Token');
    });
  });

  // ==================================================
  // FULL END-TO-END ORCHESTRATION WITH CHAIN TARGET
  // ==================================================
  describe('End-to-End Orchestrator Execution for Chain-First Investigation', () => {
    it('executes chain investigation without asking for token', async () => {
      const manager = new InvestigationManager();
      const mockEvidence: EvidenceItem = {
        evidenceId: 'ev_chain_1',
        investigationId: 'inv_chain_test',
        title: 'Chain Whale Activity',
        summary: 'Largest whale cohort accumulation detected on Ethereum',
        epistemicStatus: 'ESTABLISHED_FACT',
        confidenceScore: 0.95,
        confidenceReason: 'Verified on-chain transactions',
        provenance: {
          source: 'nansen',
          endpoint: '/api/v1/test',
          capability: 'flow_intelligence',
          chain: 'ethereum',
          tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          extractedAt: '2026-03-20T00:00:00.000Z',
          creditsCost: 1,
        },
        rawPayload: { test: true },
        normalizedData: { test: true },
        createdAt: '2026-03-20T00:00:00.000Z',
      };

      const executorMock = {
        executeMany: vi.fn().mockResolvedValue([
          {
            success: true,
            capability: 'flow_intelligence',
            cacheHit: false,
            evidence: [mockEvidence],
            actualCreditCost: 1,
            durationMs: 15,
            errors: [],
          },
        ]),
      } as unknown as EvidenceExecutor;

      const synthesizer = new EvidenceSynthesisEngine(new MockLLMProvider());
      const orchestrator = new InvestigationOrchestrator({
        planner,
        executor: executorMock,
        synthesizer,
        investigationManager: manager,
        targetResolver,
      });

      // Initialize an investigation with target: chain
      const inv = manager.createInvestigation({
        telegramChatId: 987654,
        target: { type: 'chain', chain: 'ethereum', chainDisplayName: 'Ethereum' },
        initialQuestion: 'Who are the biggest whales on Ethereum?',
      });

      mockEvidence.investigationId = inv.id;

      const result = await orchestrator.executeTurn({
        investigationId: inv.id,
        chatId: 987654,
        question: 'Who are the biggest whales on Ethereum?',
      });

      expect(result.status).toBe('completed');
      expect(result.synthesis?.answer).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
    });
  });
});
