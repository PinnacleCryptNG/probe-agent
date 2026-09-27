import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { TokenContext } from '../../../src/types/domain.js';
import { TokenCandidate, TokenResolutionResult, ITokenResolver } from '../../../src/core/token/types.js';
import { EvidenceItem } from '../../../src/types/evidence.js';
import { UserFromGetMe } from 'grammy/types';
import { formatInvestigationResult } from '../../../src/adapters/telegram/formatter.js';

const MOCK_BOT_INFO: UserFromGetMe = {
  id: 999999,
  is_bot: true,
  first_name: 'PROBE Bot',
  username: 'probe_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

describe('Target Resolution & Context Switching Integration Tests', () => {
  const mockEthToken: TokenContext = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    priceUsd: 3000,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const mockBtcToken: TokenContext = {
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'ethereum',
    priceUsd: 65000,
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

  const mockPepeTokenArb: TokenContext = {
    address: '0x25d887ce7a35172c62febfd67a1856620adf2bbe',
    symbol: 'PEPE',
    name: 'Pepe',
    chain: 'arbitrum',
    priceUsd: 0.00001,
    resolvedAt: '2026-03-20T00:00:00.000Z',
  };

  const createMockTokenResolver = (): ITokenResolver => ({
    resolve: vi.fn().mockImplementation(async (candidateOrQuery) => {
      const id = typeof candidateOrQuery === 'string' ? candidateOrQuery : candidateOrQuery.identifier;
      const upper = id.toUpperCase();
      if (upper === 'BTC' || upper === 'WBTC' || upper === 'BITCOIN') return mockBtcToken;
      if (upper === 'ETH' || upper === 'ETHER' || upper === 'ETHEREUM') return mockEthToken;
      if (upper === 'SOL' || upper === 'SOLANA') return mockSolToken;
      if (upper === 'PEPE') return mockPepeTokenArb;
      return null;
    }),
    resolveDetailed: vi.fn().mockImplementation(async (candidateOrQuery: TokenCandidate | string): Promise<TokenResolutionResult> => {
      const candidate: TokenCandidate =
        typeof candidateOrQuery === 'string'
          ? { identifier: candidateOrQuery, type: 'symbol' }
          : candidateOrQuery;

      if (candidate.type === 'invalid_address') {
        return {
          status: 'INVALID_ADDRESS',
          candidate,
          failureReason: 'INVALID_ADDRESS_FORMAT',
          creditCost: 0,
        };
      }

      const upper = candidate.identifier.toUpperCase();
      if (upper === 'BTC' || upper === 'WBTC' || upper === 'BITCOIN') {
        return {
          status: 'RESOLVED',
          token: mockBtcToken,
          candidate,
          detectedChain: candidate.detectedChain || 'ethereum',
          creditCost: 0,
        };
      }
      if (upper === 'ETH' || upper === 'ETHER' || upper === 'ETHEREUM') {
        return {
          status: 'RESOLVED',
          token: mockEthToken,
          candidate,
          detectedChain: candidate.detectedChain || 'ethereum',
          creditCost: 0,
        };
      }
      if (upper === 'SOL' || upper === 'SOLANA') {
        return {
          status: 'RESOLVED',
          token: mockSolToken,
          candidate,
          detectedChain: 'solana',
          creditCost: 0,
        };
      }
      if (upper === 'PEPE' && candidate.detectedChain === 'arbitrum') {
        return {
          status: 'RESOLVED',
          token: mockPepeTokenArb,
          candidate,
          detectedChain: 'arbitrum',
          creditCost: 0,
        };
      }
      if (upper === 'PEPE' && !candidate.detectedChain) {
        return {
          status: 'AMBIGUOUS_SYMBOL',
          candidate,
          availableChains: ['ethereum', 'arbitrum'],
          failureReason: 'MULTIPLE_CHAINS_FOR_SYMBOL',
          creditCost: 0,
        };
      }
      return {
        status: 'NOT_FOUND',
        candidate,
        failureReason: 'NOT_INDEXED_BY_NANSEN',
        creditCost: 0,
      };
    }),
  });

  let manager: InvestigationManager;
  let targetResolver: TargetResolver;
  let orchestrator: InvestigationOrchestrator;
  let probeBot: ProbeTelegramBot;
  let sentMessages: Array<{ chatId: number | string; text: string }>;
  let planner: InvestigationPlanner;
  let executor: EvidenceExecutor;
  let synthesizer: EvidenceSynthesisEngine;

  beforeEach(() => {
    manager = new InvestigationManager();
    const tokenResolver = createMockTokenResolver();
    targetResolver = new TargetResolver(tokenResolver);
    planner = new InvestigationPlanner();

    executor = {
      executeMany: vi.fn().mockImplementation(async (requirements, execContext) => {
        const invId = execContext?.investigationId ?? 'inv_test_ctx';
        const evidence: EvidenceItem[] = [
          {
            evidenceId: 'evi_tx_1',
            investigationId: invId,
            title: 'Large Transfers Test Data',
            summary: 'Large whale transfers observed on-chain',
            epistemicStatus: 'OBSERVATION',
            confidenceScore: 1.0,
            confidenceReason: 'Verified deterministic test data',
            provenance: {
              source: 'nansen',
              endpoint: '/transfers',
              capability: 'token_transfers',
              chain: 'ethereum',
              tokenAddress: mockEthToken.address,
              extractedAt: '2026-03-20T00:00:00.000Z',
              creditsCost: 1,
            },
            rawPayload: {
              transfers: [
                {
                  amount: 1500,
                  amountUsd: 4500000,
                  fromAddress: '0x1111111111111111111111111111111111111111',
                  toAddress: '0x2222222222222222222222222222222222222222',
                  transactionHash: '0xabc123',
                  timestamp: '2026-03-19T10:00:00.000Z',
                },
                {
                  amount: 800,
                  amountUsd: 2400000,
                  fromAddress: '0x3333333333333333333333333333333333333333',
                  toAddress: '0x4444444444444444444444444444444444444444',
                  transactionHash: '0xdef456',
                  timestamp: '2026-03-19T12:00:00.000Z',
                },
              ],
            },
            normalizedData: {
              netVolumeUsd: 6900000,
              transfers: [
                {
                  amount: 1500,
                  amountUsd: 4500000,
                  fromAddress: '0x1111111111111111111111111111111111111111',
                  toAddress: '0x2222222222222222222222222222222222222222',
                  transactionHash: '0xabc123',
                  timestamp: '2026-03-19T10:00:00.000Z',
                },
                {
                  amount: 800,
                  amountUsd: 2400000,
                  fromAddress: '0x3333333333333333333333333333333333333333',
                  toAddress: '0x4444444444444444444444444444444444444444',
                  transactionHash: '0xdef456',
                  timestamp: '2026-03-19T12:00:00.000Z',
                },
              ],
            },
            createdAt: '2026-03-20T00:00:00.000Z',
          },
        ];

        return requirements.map((r: any) => ({
          success: true,
          capability: r.capabilityName,
          cacheHit: false,
          evidence,
          actualCreditCost: 1,
          durationMs: 10,
          errors: [],
        }));
      }),
    } as unknown as EvidenceExecutor;

    synthesizer = new EvidenceSynthesisEngine({
      llmProvider: new MockLLMProvider(),
    });

    orchestrator = new InvestigationOrchestrator({
      manager,
      planner,
      executor,
      synthesizer,
      targetResolver,
    });

    probeBot = new ProbeTelegramBot({
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      orchestrator,
      investigationManager: manager,
      targetResolver,
      tokenResolver,
    });

    const bot = probeBot.getBot();
    bot.botInfo = MOCK_BOT_INFO;

    sentMessages = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { chat_id: number | string; text: string };
        sentMessages.push({ chatId: p.chat_id, text: p.text });
        return {
          ok: true,
          result: {
            message_id: sentMessages.length,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(p.chat_id), type: 'private' },
            text: p.text,
          },
        } as never;
      }
      if (method === 'editMessageText') {
        const p = payload as { chat_id: number | string; message_id: number; text: string };
        const msg = sentMessages[p.message_id - 1];
        if (msg) {
          msg.text = p.text;
        }
        return { ok: true, result: true } as never;
      }
      return { ok: true, result: {} } as never;
    });
  });

  // Test 1: ETH -> $BTC context switch
  it('correctly switches context from active ETH to BTC when user asks "Why is $BTC pumping suddenly"', async () => {
    const bot = probeBot.getBot();
    const chatId = 501;

    // 1. First turn: user starts on ETH
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'ETH',
      },
    });

    const activeInv1 = manager.getActiveInvestigationByChatId(chatId);
    expect(activeInv1).toBeDefined();
    expect(activeInv1?.token.symbol).toBe('ETH');

    // 2. Second turn: user asks about $BTC
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'Why is $BTC pumping suddenly',
      },
    });

    // Verify response header is BTC, NOT ETH
    const latestMessage = sentMessages[sentMessages.length - 1];
    expect(latestMessage.text).toContain('🔎 BTC — Why is $BTC pumping suddenly');
    expect(latestMessage.text).not.toContain('🔎 ETH');

    // Verify active investigation is now BTC
    const activeInv2 = manager.getActiveInvestigationByChatId(chatId);
    expect(activeInv2).toBeDefined();
    expect(activeInv2?.token.symbol).toBe('BTC');
    expect(activeInv2?.target?.type).toBe('token');
  });

  // Test 2: ETH -> BTC context switch
  it('correctly switches context from active ETH to BTC when user asks "What about BTC?"', async () => {
    const bot = probeBot.getBot();
    const chatId = 502;

    // Initialize with active ETH
    manager.createInvestigation({
      telegramChatId: chatId,
      token: mockEthToken,
      target: { type: 'token', token: mockEthToken, chain: 'ethereum', rawIdentifier: 'ETH' },
    });

    await bot.handleUpdate({
      update_id: 10,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'What about BTC?',
      },
    });

    const latestMessage = sentMessages[sentMessages.length - 1];
    expect(latestMessage.text).toContain('🔎 BTC — What about BTC?');
    expect(latestMessage.text).not.toContain('🔎 ETH');

    const active = manager.getActiveInvestigationByChatId(chatId);
    expect(active?.token.symbol).toBe('BTC');
  });

  // Test 3: ETH -> Bitcoin context switch
  it('correctly switches context from active ETH to BTC when user asks "Why is Bitcoin pumping?"', async () => {
    const bot = probeBot.getBot();
    const chatId = 503;

    manager.createInvestigation({
      telegramChatId: chatId,
      token: mockEthToken,
      target: { type: 'token', token: mockEthToken, chain: 'ethereum', rawIdentifier: 'ETH' },
    });

    await bot.handleUpdate({
      update_id: 20,
      message: {
        message_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'Why is Bitcoin pumping?',
      },
    });

    const latestMessage = sentMessages[sentMessages.length - 1];
    expect(latestMessage.text).toContain('🔎 BTC — Why is Bitcoin pumping?');
    expect(latestMessage.text).not.toContain('🔎 ETH');

    const active = manager.getActiveInvestigationByChatId(chatId);
    expect(active?.token.symbol).toBe('BTC');
  });

  // Test 4: ETH -> SOL context switch
  it('correctly switches context from active ETH to SOL when user asks "Who is buying SOL?"', async () => {
    const bot = probeBot.getBot();
    const chatId = 504;

    manager.createInvestigation({
      telegramChatId: chatId,
      token: mockEthToken,
      target: { type: 'token', token: mockEthToken, chain: 'ethereum', rawIdentifier: 'ETH' },
    });

    await bot.handleUpdate({
      update_id: 30,
      message: {
        message_id: 30,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'Who is buying SOL?',
      },
    });

    const latestMessage = sentMessages[sentMessages.length - 1];
    expect(latestMessage.text).toContain('🔎 SOL — Who is buying SOL?');
    expect(latestMessage.text).not.toContain('🔎 ETH');

    const active = manager.getActiveInvestigationByChatId(chatId);
    expect(active?.token.symbol).toBe('SOL');
    expect(active?.token.chain).toBe('solana');
  });

  // Test 5: /new reset clears context completely
  it('/new completely resets investigation context and subsequent generic question prompts for token', async () => {
    const bot = probeBot.getBot();
    const chatId = 505;

    // Start with active ETH
    manager.createInvestigation({
      telegramChatId: chatId,
      token: mockEthToken,
      target: { type: 'token', token: mockEthToken, chain: 'ethereum', rawIdentifier: 'ETH' },
    });
    expect(manager.getActiveInvestigationByChatId(chatId)).toBeDefined();

    // Send /new
    await bot.handleUpdate({
      update_id: 40,
      message: {
        message_id: 40,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: '/new',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }],
      },
    });

    // Active context must be cleared
    expect(manager.getActiveInvestigationByChatId(chatId)).toBeUndefined();
    expect(sentMessages[sentMessages.length - 1].text).toContain('🔎 PROBE');
    expect(sentMessages[sentMessages.length - 1].text).toContain('Send me a token symbol or contract address.');

    // Next question without target asks user for token, DOES NOT use old ETH context
    await bot.handleUpdate({
      update_id: 41,
      message: {
        message_id: 41,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'Who is buying?',
      },
    });

    expect(sentMessages[sentMessages.length - 1].text).toBe(
      'Which token would you like to investigate?\n\nSend a token symbol or contract address.'
    );
  });

  // Test 6: Biggest transactions intent actually presents transaction/transfer evidence
  it('actually presents individual transfer evidence for "What were the biggest transactions this week for ETH on Ethereum?"', async () => {
    const bot = probeBot.getBot();
    const chatId = 506;

    await bot.handleUpdate({
      update_id: 50,
      message: {
        message_id: 50,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Bob' },
        text: 'What were the biggest transactions this week for ETH on Ethereum?',
      },
    });

    const latestMessage = sentMessages[sentMessages.length - 1];
    // Must contain specific transfer observation details with amount and USD value
    expect(latestMessage.text).toContain('1,500.00 ETH ($4.50M)');
    expect(latestMessage.text).toContain('0x1111');
    expect(latestMessage.text).toContain('0x2222');
    expect(latestMessage.text).toContain('800.00 ETH ($2.40M)');
    expect(latestMessage.text).toContain('0x3333');
    expect(latestMessage.text).toContain('0x4444');
  });

  // Test 7: Formatter uses target as source of truth for header symbol
  it('formats investigation header using turnResult.target even if old token exists', () => {
    const turnResult = {
      investigationId: 'inv_123',
      turnId: 'turn_1',
      status: 'completed' as const,
      question: 'Why is $BTC pumping suddenly',
      target: {
        type: 'token' as const,
        token: mockBtcToken,
        chain: 'ethereum',
        rawIdentifier: 'BTC',
      },
      token: mockBtcToken,
      evidence: [],
      synthesis: {
        success: true,
        answer: 'BTC inflows increased significantly.',
        observations: [{ id: 'obs_1', statement: 'Large inflows recorded.' }],
        interpretations: [],
        hypotheses: [],
        unknowns: [],
        evidenceRefs: [],
        validated: true,
        investigationId: 'inv_123',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    };

    const formatted = formatInvestigationResult(turnResult);
    expect(formatted).toContain('🔎 BTC — Why is $BTC pumping suddenly');
    expect(formatted).not.toContain('🔎 ETH');
  });
});
