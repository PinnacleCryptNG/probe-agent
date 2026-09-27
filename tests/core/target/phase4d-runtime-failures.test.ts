import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { TokenResolver } from '../../../src/core/token/resolver.js';
import { INansenClient } from '../../../src/core/nansen/client.js';
import { TokenTarget, ChainTarget } from '../../../src/core/target/types.js';
import { TelegramMessages } from '../../../src/adapters/telegram/messages.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { formatInvestigationResult } from '../../../src/adapters/telegram/formatter.js';
import { EvidenceNormalizer } from '../../../src/core/evidence/normalizer.js';

describe('Phase 4D — Runtime Failures Regression Test Suite', () => {
  let mockNansenClient: INansenClient;
  let tokenResolver: TokenResolver;
  let targetResolver: TargetResolver;
  let capabilityRegistry: CapabilityRegistry;
  let planner: InvestigationPlanner;

  beforeEach(() => {
    mockNansenClient = {
      searchGeneral: vi.fn().mockImplementation(async (req: any) => {
        const query = typeof req === 'string' ? req : (req.search_query ?? req.query ?? '');
        const q = String(query).trim().toUpperCase();
        if (q === 'PEPE') {
          return {
            data: {
              tokens: [
                {
                  name: 'Pepe',
                  symbol: 'PEPE',
                  chain: 'ethereum',
                  address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
                  marketCapUsd: 4000000000,
                  volume24hUsd: 500000000,
                },
                {
                  name: 'Pepe',
                  symbol: 'PEPE',
                  chain: 'arbitrum',
                  address: '0x25d887ce7a35172c62febfd67a1856620adf2bbe',
                  marketCapUsd: 1000000,
                  volume24hUsd: 50000,
                },
                {
                  name: 'Pepe',
                  symbol: 'PEPE',
                  chain: 'solana',
                  address: 'So11111111111111111111111111111111111111111',
                  marketCapUsd: 500000,
                  volume24hUsd: 10000,
                },
                {
                  name: 'Pepe',
                  symbol: 'PEPE',
                  chain: 'bnb',
                  address: '0x25d887ce7a35172c62febfd67a1856620adf2bb1',
                  marketCapUsd: 200000,
                  volume24hUsd: 5000,
                },
              ],
            },
            meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
          };
        }
        if (q === 'HYPER') {
          return {
            data: {
              tokens: [
                {
                  name: 'Hyperliquid Ecosystem Token',
                  symbol: 'HYPER',
                  chain: 'hyperliquid',
                  address: '0xhyper1234567890abcdef',
                  marketCapUsd: 50000000,
                  volume24hUsd: 10000000,
                },
                {
                  name: 'Hyper Test',
                  symbol: 'HYPER',
                  chain: 'base',
                  address: '0xbasehyper12345',
                  marketCapUsd: 5000,
                  volume24hUsd: 100,
                },
              ],
            },
            meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
          };
        }
        return { data: { tokens: [] }, meta: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 } };
      }),
    } as unknown as INansenClient;

    tokenResolver = new TokenResolver({ nansenClient: mockNansenClient });
    targetResolver = new TargetResolver(tokenResolver);
    capabilityRegistry = new CapabilityRegistry();
    planner = new InvestigationPlanner({ capabilityRegistry });
  });

  // ==================================================
  // 1. TARGET RESOLUTION
  // ==================================================
  describe('1. Target Resolution ($PEPE, $HYPER, Native Assets)', () => {
    it('$PEPE does not immediately trigger chain selection before Nansen search and resolves dominant candidate', async () => {
      const res = await targetResolver.resolve({ question: '$PEPE' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      const token = (res.target as TokenTarget).token;
      expect(token.symbol).toBe('PEPE');
      expect(token.chain).toBe('ethereum');
      expect(token.address).toBe('0x6982508145454ce325ddbe47a25d4ec3d2311933');
      expect(mockNansenClient.searchGeneral).toHaveBeenCalled();
    });

    it('$HYPER does not immediately trigger chain selection and resolves without being treated as HYPE', async () => {
      const res = await targetResolver.resolve({ question: '$HYPER' });
      expect(res.status).toBe('RESOLVED');
      expect(res.target.type).toBe('token');
      const token = (res.target as TokenTarget).token;
      expect(token.symbol).toBe('HYPER');
      expect(token.chain).toBe('hyperliquid');
      expect(mockNansenClient.searchGeneral).toHaveBeenCalled();
    });

    it('Native HYPE and $HYPE resolve to Hyperliquid native asset without calling Nansen search', async () => {
      const res1 = await targetResolver.resolve({ question: 'HYPE' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('HYPE');
      expect((res1.target as TokenTarget).chain).toBe('hyperliquid');

      const res2 = await targetResolver.resolve({ question: '$HYPE' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('HYPE');
      expect((res2.target as TokenTarget).chain).toBe('hyperliquid');
      expect(mockNansenClient.searchGeneral).not.toHaveBeenCalled();
    });

    it('Native SOL and $SOL resolve to Solana native asset without calling Nansen search', async () => {
      const res1 = await targetResolver.resolve({ question: 'SOL' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('SOL');
      expect((res1.target as TokenTarget).chain).toBe('solana');

      const res2 = await targetResolver.resolve({ question: '$SOL' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('SOL');
      expect((res2.target as TokenTarget).chain).toBe('solana');
      expect(mockNansenClient.searchGeneral).not.toHaveBeenCalled();
    });

    it('Native APT and $APT resolve to Aptos native asset without calling Nansen search', async () => {
      const res1 = await targetResolver.resolve({ question: 'APT' });
      expect(res1.status).toBe('RESOLVED');
      expect(res1.target.type).toBe('token');
      expect((res1.target as TokenTarget).token.symbol).toBe('APT');
      expect((res1.target as TokenTarget).chain).toBe('aptos');

      const res2 = await targetResolver.resolve({ question: '$APT' });
      expect(res2.status).toBe('RESOLVED');
      expect(res2.target.type).toBe('token');
      expect((res2.target as TokenTarget).token.symbol).toBe('APT');
      expect((res2.target as TokenTarget).chain).toBe('aptos');
      expect(mockNansenClient.searchGeneral).not.toHaveBeenCalled();
    });
  });

  // ==================================================
  // 2. NATIVE-ASSET CONFIRMATION UX
  // ==================================================
  describe('2. Native Asset Confirmation UX', () => {
    it('renders "🔎 APT · Aptos" and "What would you like to investigate?" for native APT', () => {
      const msg = TelegramMessages.tokenSelected('APT', 'Aptos', true);
      expect(msg).toContain('🔎 APT · Aptos');
      expect(msg).toContain('What would you like to investigate?');
    });

    it('renders "🔎 HYPE · Hyperliquid" and "What would you like to investigate?" for native HYPE', () => {
      const msg = TelegramMessages.tokenSelected('HYPE', 'Hyperliquid', true);
      expect(msg).toContain('🔎 HYPE · Hyperliquid');
      expect(msg).toContain('What would you like to investigate?');
    });

    it('renders "🔎 SOL · Solana" and "What would you like to investigate?" for native SOL', () => {
      const msg = TelegramMessages.tokenSelected('SOL', 'Solana', true);
      expect(msg).toContain('🔎 SOL · Solana');
      expect(msg).toContain('What would you like to investigate?');
    });

    it('renders standard "🔎 PEPE" and "What do you want to investigate?" for non-native tokens', () => {
      const msg = TelegramMessages.tokenSelected('PEPE', undefined, false);
      expect(msg).toContain('🔎 PEPE');
      expect(msg).not.toContain('·');
      expect(msg).toContain('What do you want to investigate?');
    });
  });

  // ==================================================
  // 3. LARGE TRANSACTIONS & TIME WINDOWS
  // ==================================================
  describe('3. Large Transactions & Time Windows', () => {
    it('ETH + "biggest transactions this week" plans large_transactions with 7d time window and selects token_transfers', async () => {
      const targetRes = await targetResolver.resolve({ question: 'ETH' });
      const plan = await planner.plan({ target: targetRes.target }, 'biggest transactions this week');

      expect(plan.intent).toBe('large_transactions');
      expect(plan.selectedCapabilities).toContain('token_transfers');
      const transferReq = plan.plannedCapabilities.find((c) => c.name === 'token_transfers');
      expect(transferReq).toBeDefined();
      expect(transferReq?.parameters.timeframe).toBe('7d');
      expect(transferReq?.parameters.time_window).toBe('this week');
    });

    it('SOL + "biggest transactions today" plans large_transactions with 24h time window and selects token_transfers', async () => {
      const targetRes = await targetResolver.resolve({ question: 'SOL' });
      const plan = await planner.plan({ target: targetRes.target }, 'biggest transactions today');

      expect(plan.intent).toBe('large_transactions');
      expect(plan.selectedCapabilities).toContain('token_transfers');
      const transferReq = plan.plannedCapabilities.find((c) => c.name === 'token_transfers');
      expect(transferReq).toBeDefined();
      expect(transferReq?.parameters.timeframe).toBe('1d');
      expect(transferReq?.parameters.time_window).toBe('today');
    });

    it('Chain target Ethereum + "biggest transactions this week" resolves chain target and plans large_transactions using native ETH', async () => {
      const targetRes = await targetResolver.resolve({ question: 'Ethereum' });
      expect(targetRes.target.type).toBe('chain');
      expect((targetRes.target as ChainTarget).chain).toBe('ethereum');

      const plan = await planner.plan({ target: targetRes.target }, 'biggest transactions this week');
      expect(plan.intent).toBe('large_transactions');
      expect(plan.selectedCapabilities).toContain('token_transfers');
      const transferReq = plan.plannedCapabilities.find((c) => c.name === 'token_transfers');
      expect(transferReq?.parameters.chain).toBe('ethereum');
      expect(transferReq?.parameters.time_window).toBe('this week');
    });

    it('normalizes and ranks individual token transfers largest-first with required metadata fields', () => {
      const rawTransfers = [
        {
          transaction_hash: '0xhash11111111111111111111111111111111',
          block_timestamp: '2026-03-20T10:00:00Z',
          chain: 'ethereum',
          token_symbol: 'ETH',
          transfer_amount: 100,
          amount_usd: 300000,
          from_address: '0xfrom11111111111111111111111111111111',
          to_address: '0xto11111111111111111111111111111111',
        },
        {
          transaction_hash: '0xhash22222222222222222222222222222222',
          block_timestamp: '2026-03-20T11:00:00Z',
          chain: 'ethereum',
          token_symbol: 'ETH',
          transfer_amount: 500,
          amount_usd: 1500000,
          from_address: '0xfrom22222222222222222222222222222222',
          to_address: '0xto22222222222222222222222222222222',
        },
      ];

      const normalizer = new EvidenceNormalizer();
      const items = normalizer.normalize({
        capability: 'token_transfers',
        rawData: { data: rawTransfers },
        provenance: {
          source: 'nansen',
          capability: 'token_transfers',
          endpoint: '/api/v1/tgm/token-transfers',
          chain: 'ethereum',
          tokenAddress: '0x123',
          queryParams: {},
          retrievedAt: new Date().toISOString(),
          creditsCost: 1,
        },
        investigationId: 'inv_test_transfers',
      });

      const transfers = (items[0].normalizedData as any).transfers;
      expect(transfers).toHaveLength(2);
      // Ranked largest first by USD value
      expect(transfers[0].usdValue).toBe(1500000);
      expect(transfers[0].transactionHash).toBe('0xhash22222222222222222222222222222222');
      expect(transfers[0].amount).toBe(500);
      expect(transfers[1].usdValue).toBe(300000);
    });
  });

  // ==================================================
  // 4. CAPABILITY FAILURE & APT CONTEXT PRESERVATION
  // ==================================================
  describe('4. Capability Failure & APT Context Preservation', () => {
    it('active APT preserves APT target for "what were the biggest transactions this week?"', async () => {
      const activeAptRes = await targetResolver.resolve({ question: 'APT' });
      expect(activeAptRes.target.type).toBe('token');
      expect((activeAptRes.target as TokenTarget).token.symbol).toBe('APT');

      // User asks follow-up with active APT context
      const followUpRes = await targetResolver.resolve({
        question: 'what were the biggest transactions this week?',
        existingTarget: activeAptRes.target,
      });

      expect(followUpRes.status).toBe('RESOLVED');
      expect(followUpRes.target.type).toBe('token');
      expect((followUpRes.target as TokenTarget).token.symbol).toBe('APT');
      expect((followUpRes.target as TokenTarget).token.chain).toBe('aptos');
    });

    it('APT + large_transactions returns deterministic capability_unavailable message rather than generic synthesis failure', async () => {
      const manager = new InvestigationManager();
      const mockExecutor: EvidenceExecutor = {
        executeMany: vi.fn(),
      } as unknown as EvidenceExecutor;
      const mockSynthesizer: EvidenceSynthesisEngine = {
        synthesize: vi.fn(),
      } as unknown as EvidenceSynthesisEngine;

      const orchestrator = new InvestigationOrchestrator({
        investigationManager: manager,
        planner,
        executor: mockExecutor,
        synthesizer: mockSynthesizer,
        targetResolver,
      });

      const aptTargetRes = await targetResolver.resolve({ question: 'APT' });
      const aptTarget = aptTargetRes.target as TokenTarget;

      const turnResult = await orchestrator.executeTurn({
        question: 'what were the biggest transactions this week?',
        token: aptTarget.token,
        target: aptTarget,
      });

      // Must be capability_unavailable status
      expect(turnResult.status).toBe('capability_unavailable');
      expect(turnResult.error?.code).toBe('CHAIN_UNSUPPORTED');
      expect(turnResult.error?.message).toContain(
        "I couldn't retrieve verified transaction-level data for APT over this period because the available Nansen capability does not support that query."
      );

      // Verify telegram formatter renders this exact user-friendly message without vague generic synthesis prose
      const formatted = formatInvestigationResult(turnResult);
      expect(formatted).toBe(
        "I couldn't retrieve verified transaction-level data for APT over this period because the available Nansen capability does not support that query."
      );
      expect(formatted).not.toContain("I couldn't establish a reliable explanation");

      // Synthesizer/LLM must NOT have been called on empty evidence
      expect(mockSynthesizer.synthesize).not.toHaveBeenCalled();
    });
  });
});
