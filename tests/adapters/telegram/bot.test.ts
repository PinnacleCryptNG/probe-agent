import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFromGetMe } from 'grammy/types';
import {
  formatInvestigationResult,
  splitTelegramMessage,
} from '../../../src/adapters/telegram/formatter.js';
import { TelegramMessages } from '../../../src/adapters/telegram/messages.js';
import { extractTokenFromText } from '../../../src/adapters/telegram/token-extractor.js';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationTurnResult } from '../../../src/core/investigation/types.js';

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

describe('Telegram Adapter Integration (Phase 3A)', () => {
  let manager: InvestigationManager;
  let orchestratorMock: InvestigationOrchestrator;
  let probeBot: ProbeTelegramBot;
  let sentMessages: Array<{ chatId: number | string; text: string; options?: Record<string, unknown> }>;
  let answeredCallbacks: string[];

  beforeEach(() => {
    manager = new InvestigationManager();
    sentMessages = [];
    answeredCallbacks = [];

    orchestratorMock = {
      executeTurn: vi.fn().mockResolvedValue({
        investigationId: 'inv_mock_123',
        turnId: 'turn_mock_1',
        status: 'completed',
        question: 'Why is ETH activity changing?',
        evidence: [],
        synthesis: {
          success: true,
          answer: 'The available evidence shows increased large-wallet inflows.',
          observations: [
            {
              id: 'obs_1',
              statement: 'Large-wallet inflows increased during the observed period.',
              evidenceRefs: ['evi_1'],
            },
          ],
          interpretations: [
            {
              id: 'interp_1',
              statement: 'The available evidence is consistent with increased accumulation activity.',
              confidence: 'high',
              evidenceRefs: ['evi_1'],
            },
          ],
          hypotheses: [
            {
              id: 'hyp_1',
              statement: 'Some of the increase may be associated with large-holder positioning.',
              evidenceRefs: ['evi_1'],
            },
          ],
          unknowns: [
            {
              statement: 'The evidence does not establish why those wallets accumulated.',
              reason: 'Off-chain motive cannot be verified.',
            },
          ],
          evidenceRefs: ['evi_1'],
          followUpQuestions: ['Did the same wallets continue accumulating afterward?'],
          validated: true,
          investigationId: 'inv_mock_123',
          createdAt: '2026-03-20T12:00:00.000Z',
        },
      } as InvestigationTurnResult),
    } as unknown as InvestigationOrchestrator;

    probeBot = new ProbeTelegramBot({
      botToken: 'dummy_token_12345:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      orchestrator: orchestratorMock,
      investigationManager: manager,
    });

    const bot = probeBot.getBot();
    bot.botInfo = MOCK_BOT_INFO;

    // Intercept outgoing Telegram API calls via grammY transformer middleware
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { chat_id: number | string; text: string };
        sentMessages.push({ chatId: p.chat_id, text: p.text, options: payload as Record<string, unknown> });
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
      if (method === 'answerCallbackQuery') {
        const p = payload as { callback_query_id: string };
        answeredCallbacks.push(p.callback_query_id);
        return { ok: true, result: true } as never;
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

  // 1. /start response (Token first, no buttons)
  it('1. responds to /start with token-first onboarding and without generic investigation buttons', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 101,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    });

    expect(sentMessages).toHaveLength(1);
    const reply = sentMessages[0];
    expect(reply.text).toContain('🔎 PROBE');
    expect(reply.text).toContain('Investigate on-chain activity using evidence from the chain.');
    expect(reply.text).toContain('Send me a token symbol or contract address.');
    expect(reply.text).toContain('• ETH');
    expect(reply.text).toContain('• SOL');
    expect(reply.text).toContain('• 0x...');
    expect(reply.options?.reply_markup).toBeUndefined();
  });

  // 2. /help response
  it('2. responds to /help explaining natural-language questions and epistemic distinctions', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 102,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: '/help',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    });

    expect(sentMessages).toHaveLength(1);
    const reply = sentMessages[0];
    expect(reply.text).toContain('PROBE Investigation Guide');
    expect(reply.text).toContain('Natural-Language Questions');
    expect(reply.text).toContain('Evidence-Grounded');
    expect(reply.text).toContain('Epistemic Clarity');
    expect(reply.text).toContain('Follow-Up Questions');
  });

  // 3. /new creates/resets investigation context
  it('3. resets active investigation context and prompts for token when /new command is sent', async () => {
    // Setup existing active investigation for chat 12345
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0x1111111111111111111111111111111111111111',
        symbol: 'OLD',
        name: 'OldToken',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    expect(manager.getActiveInvestigationByChatId(12345)).toBeDefined();

    const bot = probeBot.getBot();
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 103,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: '/new',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }],
      },
    });

    // Active investigation should now be cleared
    expect(manager.getActiveInvestigationByChatId(12345)).toBeUndefined();
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('🔎 PROBE');
    expect(sentMessages[0].text).toContain('Send me a token symbol or contract address.');
    expect(sentMessages[0].options?.reply_markup).toBeUndefined();
  });

  // 4. Natural-language message reaches InvestigationOrchestrator
  it('4. routes an arbitrary natural-language question with token to InvestigationOrchestrator', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 104,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'Why is ETH activity changing?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledTimes(1);
    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        question: 'Why is ETH activity changing?',
      })
    );
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('🔎 ETH');
    expect(sentMessages[0].text).toContain('• Large-wallet inflows increased');
    expect(sentMessages[0].text).toContain('Ask another question about ETH.');
    expect(sentMessages[0].text).not.toContain('Follow up');
  });

  // 5. Token message creates active token context and displays investigation shortcuts
  it('5. token message creates active token context and displays investigation shortcuts', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 5,
      message: {
        message_id: 105,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'ETH',
      },
    });

    expect(manager.getActiveInvestigationByChatId(12345)).toBeDefined();
    expect(manager.getActiveInvestigationByChatId(12345)?.token.symbol).toBe('ETH');
    expect(sentMessages).toHaveLength(1);

    const reply = sentMessages[0];
    expect(reply.text).toContain('🔎 ETH');
    expect(reply.text).toContain('What do you want to investigate?');
    expect(reply.text).toContain('Or ask me anything.');
    expect(reply.options?.reply_markup).toBeDefined();

    // Clicking shortcut executes turn using active token
    await bot.handleUpdate({
      update_id: 51,
      callback_query: {
        id: 'cb_1',
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        message: {
          message_id: 105,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: 'private' },
          text: 'Prompt',
        },
        chat_instance: '1',
        data: 'shortcut_whats_happening',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        question: "What's happening?",
        token: expect.objectContaining({ symbol: 'ETH' }),
      })
    );
    expect(answeredCallbacks).toContain('cb_1');
  });

  // 6. Chain-only input asks for token on that chain
  it('6. chain-only input asks for token on that chain concisely', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 52,
      message: {
        message_id: 107,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'solana',
      },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe('Which token on Solana?\n\nSend the token symbol or contract address.');
  });

  // 7. Unresolved token produces concise clarification
  it('7. unresolved token produces concise clarification', async () => {
    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 53,
      message: {
        message_id: 108,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: '0xinvalidaddress123',
      },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe("I couldn't identify that token.\n\nSend a token symbol or contract address.");
  });

  // 8. Natural-language follow-up uses active token
  it('8. natural-language follow-up uses active token without repeating token name', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 54,
      message: {
        message_id: 109,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'Why did activity spike today?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 12345,
        question: 'Why did activity spike today?',
        token: expect.objectContaining({ symbol: 'ETH' }),
      })
    );
  });

  // 9. Follow-up pronouns preserve investigation context
  it('9. follow-up pronouns preserve investigation context', async () => {
    const inv = manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
      initialQuestion: 'Why did activity spike today?',
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 55,
      message: {
        message_id: 110,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'What caused it?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        investigationId: inv.id,
        chatId: 12345,
        question: 'What caused it?',
        token: expect.objectContaining({ symbol: 'ETH' }),
      })
    );
  });

  // Preserves active investigation ID across sequential follow-up questions
  it('preserves active investigation ID across sequential follow-up questions', async () => {
    const inv = manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0x1234567890123456789012345678901234567890',
        symbol: 'PEPE',
        name: 'Pepe',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 106,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'Are whales buying?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        investigationId: inv.id,
        chatId: 12345,
        question: 'Are whales buying?',
      })
    );
  });

  // 7. Different Telegram users remain isolated
  it('7. keeps separate Telegram chat/user investigation contexts strictly isolated', async () => {
    const invA = manager.createInvestigation({
      telegramChatId: 101,
      token: {
        address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        symbol: 'TOKEN_A',
        name: 'TokenA',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const invB = manager.createInvestigation({
      telegramChatId: 202,
      token: {
        address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        symbol: 'TOKEN_B',
        name: 'TokenB',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    // User A query
    await bot.handleUpdate({
      update_id: 71,
      message: {
        message_id: 201,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 101, type: 'private' },
        from: { id: 101, is_bot: false, first_name: 'UserA' },
        text: 'Who is accumulating?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        investigationId: invA.id,
        chatId: 101,
      })
    );

    // User B query
    await bot.handleUpdate({
      update_id: 72,
      message: {
        message_id: 202,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 202, type: 'private' },
        from: { id: 202, is_bot: false, first_name: 'UserB' },
        text: 'Show transfers',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        investigationId: invB.id,
        chatId: 202,
      })
    );
  });

  // 8. Completed synthesis renders correctly
  it('8. formats a completed SynthesisResult with clear epistemic headers and bullets', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_8',
      turnId: 'turn_8',
      status: 'completed',
      question: "What's happening?",
      evidence: [],
      synthesis: {
        success: true,
        answer: 'Completed summary',
        observations: [
          {
            id: 'obs_1',
            statement: 'Large-wallet inflows increased by $5M.',
            evidenceRefs: ['evi_1'],
          },
        ],
        interpretations: [
          {
            id: 'int_1',
            statement: 'Consistent with early smart money accumulation.',
            confidence: 'high',
            evidenceRefs: ['evi_1'],
          },
        ],
        hypotheses: [
          {
            id: 'hyp_1',
            statement: 'Wallets may be preparing for a liquidity event.',
            evidenceRefs: ['evi_1'],
          },
        ],
        unknowns: [
          {
            statement: 'Private OTC negotiations cannot be confirmed.',
            reason: 'Off-chain boundary.',
          },
        ],
        evidenceRefs: ['evi_1'],
        followUpQuestions: ['Want me to inspect top buyers?'],
        validated: true,
        investigationId: 'inv_test_8',
        createdAt: '2026-03-20T12:00:00.000Z',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain('🔎 ETH — What\'s happening?');
    expect(formatted).toContain('Consistent with early smart money accumulation.');
    expect(formatted).toContain('• Large-wallet inflows increased by $5M.');
    expect(formatted).not.toContain('Follow up');
    expect(formatted).not.toContain('Would you like to retrieve baseline');
    expect(formatted).toContain('Ask another question about ETH.');
  });

  // 9. Unknown/empty sections are omitted
  it('9. omits Hypothesis and Unknown headers when those sections contain no items', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_9',
      turnId: 'turn_9',
      status: 'completed',
      question: 'Check activity',
      evidence: [],
      synthesis: {
        success: true,
        answer: 'Summary',
        observations: [
          {
            id: 'obs_1',
            statement: '24h DEX volume rose 40%.',
            evidenceRefs: ['evi_1'],
          },
        ],
        interpretations: [
          {
            id: 'int_1',
            statement: 'Trading activity is predominantly Uniswap V3.',
            confidence: 'medium',
            evidenceRefs: ['evi_1'],
          },
        ],
        hypotheses: [], // Empty
        unknowns: [], // Empty
        evidenceRefs: ['evi_1'],
        followUpQuestions: [],
        validated: true,
        investigationId: 'inv_test_9',
        createdAt: '2026-03-20T12:00:00.000Z',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain('🔎 ETH — Check activity');
    expect(formatted).toContain('Trading activity is predominantly Uniswap V3.');
    expect(formatted).toContain('• 24h DEX volume rose 40%.');
    expect(formatted).not.toContain('Hypothesis');
    expect(formatted).not.toContain('Unknown');
    expect(formatted).not.toContain('Follow up');
    expect(formatted).toContain('Ask another question about ETH.');
  });

  // 10. needs_clarification renders safely
  it('10. renders safe clarification message when more input is required', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_10',
      turnId: 'turn_10',
      status: 'needs_clarification',
      question: 'What did this wallet do?',
      evidence: [],
      clarificationQuestions: ['Please specify a target wallet address (0x...) to analyze its activity.'],
      unresolvedRequirements: ['target_wallet_address'],
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toBe('Please specify a target wallet address (0x...) to analyze its activity.');
  });

  // Unsupported questions
  it('renders concise useful response for unsupported questions', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_unsupported',
      turnId: 'turn_unsupported',
      status: 'needs_clarification',
      question: 'Will ETH hit $10000 next month?',
      evidence: [],
      clarificationQuestions: [
        "I can't verify future price predictions from on-chain evidence.\n\nI can investigate the on-chain activity instead.\n\nExamples:\n• What's happening?\n• Who is buying?\n• Biggest transactions",
      ],
      unresolvedRequirements: ['future price projection or off-chain subjective intent'],
    };

    const formatted = formatInvestigationResult(turnResult);
    expect(formatted).toContain("I can't verify future price predictions from on-chain evidence.");
    expect(formatted).toContain('I can investigate the on-chain activity instead.');
    expect(formatted).toContain("• What's happening?");
    expect(formatted).not.toContain('forensics cannot predict');
  });

  // 11. insufficient_evidence renders safely
  it('11. renders safe message when on-chain evidence is insufficient', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_11',
      turnId: 'turn_11',
      status: 'insufficient_evidence',
      question: 'Why did it pump?',
      evidence: [],
      synthesis: {
        success: true,
        answer: 'Insufficient evidence',
        observations: [],
        interpretations: [],
        hypotheses: [],
        unknowns: [
          {
            statement: 'No on-chain records exist for this query timeframe.',
            reason: 'Empty result set.',
          },
        ],
        evidenceRefs: [],
        followUpQuestions: ['Should we check a 7-day window instead?'],
        validated: true,
        investigationId: 'inv_test_11',
        createdAt: '2026-03-20T12:00:00.000Z',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain("I couldn't establish a reliable explanation from the available on-chain data.");
    expect(formatted).not.toContain('Unknown');
    expect(formatted).not.toContain('Follow up');
    expect(formatted).not.toContain('Would you like to retrieve baseline token information');
    expect(formatted).not.toContain('Should we inspect cohort net flows');
    expect(formatted).toContain('Ask another question about ETH.');
  });

  // 12. budget_limited renders safely
  it('12. renders safe message explaining budget limitation with partial findings', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_12',
      turnId: 'turn_12',
      status: 'budget_limited',
      question: 'Perform complete deep dive',
      evidence: [],
      synthesis: {
        success: true,
        answer: 'Partial findings',
        observations: [
          {
            id: 'obs_partial',
            statement: 'Retrieved 1 of 4 planned requirements before budget limit was reached.',
            evidenceRefs: ['evi_1'],
          },
        ],
        interpretations: [],
        hypotheses: [],
        unknowns: [],
        evidenceRefs: ['evi_1'],
        followUpQuestions: [],
        validated: true,
        investigationId: 'inv_test_12',
        createdAt: '2026-03-20T12:00:00.000Z',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain(
      'The investigation reached the available evidence budget. The findings below are based on the evidence retrieved so far:'
    );
    expect(formatted).toContain('• Retrieved 1 of 4 planned requirements before budget limit was reached.');
    expect(formatted).not.toContain('Follow up');
    expect(formatted).toContain('Ask another question about ETH.');
  });

  // 13. execution/API error renders safely
  it('13. renders user-friendly message for execution/API errors without exposing technical internals', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_13',
      turnId: 'turn_13',
      status: 'failed',
      question: 'Query status',
      evidence: [],
      error: {
        code: 'EXECUTION_ERROR',
        message: 'Nansen HTTP 500: Internal server timeout at https://api.nansen.ai/v1/flow',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain('⚠️ An issue occurred while retrieving on-chain evidence. Please try again shortly.');
    expect(formatted).not.toContain('https://api.nansen.ai');
    expect(formatted).not.toContain('HTTP 500');
  });

  // 14. synthesis failure renders safely
  it('14. renders safe notification when synthesis validation rejects a candidate output', () => {
    const turnResult: InvestigationTurnResult = {
      investigationId: 'inv_test_14',
      turnId: 'turn_14',
      status: 'failed',
      question: 'Who bought?',
      evidence: [],
      error: {
        code: 'SYNTHESIS_VALIDATION_FAILED',
        message: 'Claim made without evidence reference',
      },
    };

    const formatted = formatInvestigationResult(turnResult);

    expect(formatted).toContain('Findings could not be verified against on-chain evidence. Claim rejected for lack of proof.');
  });

  // 15. Long messages are split safely
  it('15. splits messages exceeding length limit safely across paragraph boundaries without losing content', () => {
    const section1 = 'Observation\n' + '• ' + 'A'.repeat(2500);
    const section2 = 'Interpretation\n' + '• ' + 'B'.repeat(2500);
    const longText = `${section1}\n\n${section2}`;

    expect(longText.length).toBeGreaterThan(5000);

    const chunks = splitTelegramMessage(longText, 3000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3000);
    }

    // Verify all original content preserved across chunks
    const combined = chunks.join('\n\n');
    expect(combined).toContain('Observation');
    expect(combined).toContain('Interpretation');
    expect(combined).toContain('A'.repeat(2500));
    expect(combined).toContain('B'.repeat(2500));
  });

  // 16. No internal error details are exposed
  it('16. prevents any internal stack traces or secrets from leaking to the user', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    vi.mocked(orchestratorMock.executeTurn).mockRejectedValueOnce(
      new Error('CRITICAL DB_PASSWORD=supersecret DB_HOST=internal.cluster.local')
    );

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 16,
      message: {
        message_id: 116,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'Crash this query',
      },
    });

    expect(sentMessages).toHaveLength(1);
    const reply = sentMessages[0].text;
    expect(reply).toBe('⚠️ An unexpected issue occurred during the investigation. Please try again.');
    expect(reply).not.toContain('supersecret');
    expect(reply).not.toContain('internal.cluster.local');
    expect(reply).not.toContain('CRITICAL');
  });

  // Additional helper test: token extraction
  it('17. accurately extracts token symbols and EVM contract addresses from user prompts', () => {
    const fromEth = extractTokenFromText('Why is ETH activity changing?');
    expect(fromEth?.symbol).toBe('ETH');

    const fromCashtag = extractTokenFromText('Who is buying $PEPE right now?');
    expect(fromCashtag?.symbol).toBe('PEPE');

    const fromAddr = extractTokenFromText('Analyze 0x1234567890123456789012345678901234567890 please');
    expect(fromAddr?.address).toBe('0x1234567890123456789012345678901234567890');

    // Should ignore common interrogatives
    const noToken = extractTokenFromText('Why is activity changing?');
    expect(noToken).toBeUndefined();
  });
});

describe('Investigation UX Simplification & Grounded Evidence Tests', () => {
  let manager: InvestigationManager;
  let orchestratorMock: InvestigationOrchestrator;
  let probeBot: ProbeTelegramBot;
  let sentMessages: Array<{ chatId: number | string; text: string; options?: Record<string, unknown> }>;
  let answeredCallbacks: string[];

  beforeEach(() => {
    manager = new InvestigationManager();
    sentMessages = [];
    answeredCallbacks = [];

    orchestratorMock = {
      executeTurn: vi.fn().mockImplementation(async (req) => {
        const isUnsupported = req.question.toLowerCase().includes('hit $10,000');
        if (isUnsupported) {
          return {
            investigationId: 'inv_speculative',
            turnId: 'turn_speculative',
            status: 'needs_clarification',
            question: req.question,
            evidence: [],
            clarificationQuestions: [
              "I can't verify future price predictions from on-chain evidence.\n\nI can investigate the on-chain activity instead.\n\nExamples:\n• What's happening?\n• Who is buying?\n• Biggest transactions",
            ],
            unresolvedRequirements: ['future price projection'],
          } as InvestigationTurnResult;
        }

        const isInsufficient = req.question.toLowerCase().includes('unknown coin');
        if (isInsufficient) {
          return {
            investigationId: 'inv_insufficient',
            turnId: 'turn_insufficient',
            status: 'insufficient_evidence',
            question: req.question,
            evidence: [],
            plan: {
              planId: 'plan_insufficient',
              question: req.question,
              intent: 'activity_change',
              evidenceRequirements: [],
              selectedCapabilities: [],
              plannedCapabilities: [],
              estimatedCreditCost: 1,
              unresolvedRequirements: ['No on-chain records returned'],
              warnings: [],
              createdAt: new Date().toISOString(),
              tokenContext: req.token,
            },
            synthesis: {
              success: true,
              answer: "I couldn't establish a reliable explanation from the available on-chain data.",
              observations: [],
              interpretations: [],
              hypotheses: [],
              unknowns: [
                {
                  statement: req.question,
                  reason: 'No on-chain records exist for this query.',
                },
              ],
              evidenceRefs: [],
              followUpQuestions: [
                'Would you like to retrieve baseline token information first?',
                'Should we inspect cohort net flows?',
              ],
              validated: true,
              investigationId: 'inv_insufficient',
              createdAt: new Date().toISOString(),
            },
          } as InvestigationTurnResult;
        }

        return {
          investigationId: 'inv_normal',
          turnId: 'turn_normal',
          status: 'completed',
          question: req.question,
          plan: {
            planId: 'plan_normal',
            question: req.question,
            intent: 'activity_change',
            evidenceRequirements: [],
            selectedCapabilities: [],
            plannedCapabilities: [],
            estimatedCreditCost: 2,
            unresolvedRequirements: [],
            warnings: [],
            createdAt: new Date().toISOString(),
            tokenContext: req.token,
          },
          evidence: [
            {
              evidenceId: 'evi_1',
              provenance: {
                capability: 'flow_intelligence',
                chain: req.token?.chain ?? 'ethereum',
                queryParameters: { token_address: req.token?.address },
                retrievedAt: new Date().toISOString(),
              },
              epistemicStatus: 'OBSERVATION',
              title: 'Smart Money Net Flow',
              summary: 'Smart Money accumulated $2.4M over the last 24h.',
              data: { net_flow_usd: 2400000 },
            },
          ],
          synthesis: {
            success: true,
            answer: `Observed on-chain patterns on ${req.token?.chain ?? 'Ethereum'} reveal active accumulation.`,
            observations: [
              {
                id: 'obs_1',
                statement: 'Smart Money accumulated $2.4M over the last 24h.',
                evidenceRefs: ['evi_1'],
              },
            ],
            interpretations: [
              {
                id: 'int_1',
                statement: 'Accumulation is primarily driven by institutional smart money wallets.',
                confidence: 'high',
                evidenceRefs: ['evi_1'],
              },
            ],
            hypotheses: [],
            unknowns: [],
            evidenceRefs: ['evi_1'],
            followUpQuestions: [
              'Would you like to inspect cohort net flows?',
              'Would you like to retrieve baseline token information first?',
            ],
            validated: true,
            investigationId: 'inv_normal',
            createdAt: new Date().toISOString(),
          },
        } as InvestigationTurnResult;
      }),
    } as unknown as InvestigationOrchestrator;

    probeBot = new ProbeTelegramBot({
      botToken: 'dummy_token_12345:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      orchestrator: orchestratorMock,
      investigationManager: manager,
    });

    const bot = probeBot.getBot();
    bot.botInfo = MOCK_BOT_INFO;

    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { chat_id: number | string; text: string };
        sentMessages.push({ chatId: p.chat_id, text: p.text, options: payload as Record<string, unknown> });
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
      if (method === 'answerCallbackQuery') {
        const p = payload as { callback_query_id: string };
        answeredCallbacks.push(p.callback_query_id);
        return { ok: true, result: true } as never;
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

  // Requirement 1 & 8: Clicking "What's happening?" executes an investigation immediately
  it('1 & 8. clicking "What\'s happening?" shortcut executes an investigation immediately', async () => {
    const bot = probeBot.getBot();

    // 1. Establish active token ETH
    await bot.handleUpdate({
      update_id: 201,
      message: {
        message_id: 301,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private' },
        from: { id: 777, is_bot: false, first_name: 'Bob' },
        text: 'ETH',
      },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('🔎 ETH');

    // 2. Click shortcut "What's happening?"
    await bot.handleUpdate({
      update_id: 202,
      callback_query: {
        id: 'cb_happening',
        from: { id: 777, is_bot: false, first_name: 'Bob' },
        message: {
          message_id: 301,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          text: 'Prompt',
        },
        chat_instance: '1',
        data: 'shortcut_whats_happening',
      },
    });

    expect(answeredCallbacks).toContain('cb_happening');
    expect(orchestratorMock.executeTurn).toHaveBeenCalledTimes(1);
    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        question: "What's happening?",
        token: expect.objectContaining({ symbol: 'ETH' }),
      })
    );
  });

  // Requirement 2: The response contains the investigation result when evidence is available
  it('2. returns formatted investigation result with conclusion, observations, and evidence', async () => {
    const bot = probeBot.getBot();

    // Set active token
    manager.createInvestigation({
      telegramChatId: 777,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const mockCtx = {
      chat: { id: 777 },
      from: { id: 777 },
      reply: async (text: string) => {
        const msgId = sentMessages.length + 1;
        sentMessages.push({ chatId: 777, text });
        return { message_id: msgId, chat: { id: 777 }, text };
      },
      api: {
        editMessageText: async (_chatId: number | string, messageId: number, text: string) => {
          if (sentMessages[messageId - 1]) {
            sentMessages[messageId - 1].text = text;
          }
          return { ok: true, result: true };
        },
      },
    } as any;

    await probeBot.handleUserQuestion(mockCtx, "What's happening?");

    expect(sentMessages).toHaveLength(1);
    const text = sentMessages[0].text;
    expect(text).toContain("🔎 ETH — What's happening?");
    expect(text).toContain('Accumulation is primarily driven by institutional smart money wallets.');
    expect(text).toContain('• Smart Money accumulated $2.4M over the last 24h.');
    expect(text).toContain('Evidence');
    expect(text).toContain('• Cohort net flows');
    expect(text).not.toContain('• Smart Money Net Flow: Smart Money accumulated $2.4M');
    expect(text).toContain('Ask another question about ETH.');
  });

  // Requirement 3: Internal planner questions are never rendered to Telegram
  it('3. NEVER renders internal planner questions to Telegram', async () => {
    manager.createInvestigation({
      telegramChatId: 777,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const mockCtx = {
      chat: { id: 777 },
      from: { id: 777 },
      reply: async (text: string) => {
        const msgId = sentMessages.length + 1;
        sentMessages.push({ chatId: 777, text });
        return { message_id: msgId, chat: { id: 777 }, text };
      },
      api: {
        editMessageText: async (_chatId: number | string, messageId: number, text: string) => {
          if (sentMessages[messageId - 1]) {
            sentMessages[messageId - 1].text = text;
          }
          return { ok: true, result: true };
        },
      },
    } as any;

    await probeBot.handleUserQuestion(mockCtx, "What's happening?");

    const text = sentMessages[0].text;
    expect(text).not.toContain('Would you like to retrieve baseline token information');
    expect(text).not.toContain('Should we inspect cohort net flows');
    expect(text).not.toContain('Should we inspect transfers');
    expect(text).not.toContain('Would you like to investigate another capability');
  });

  // Requirement 4: "Follow up" is not automatically rendered
  it('4. does NOT automatically render a "Follow up" section', async () => {
    manager.createInvestigation({
      telegramChatId: 777,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const mockCtx = {
      chat: { id: 777 },
      from: { id: 777 },
      reply: async (text: string) => {
        const msgId = sentMessages.length + 1;
        sentMessages.push({ chatId: 777, text });
        return { message_id: msgId, chat: { id: 777 }, text };
      },
      api: {
        editMessageText: async (_chatId: number | string, messageId: number, text: string) => {
          if (sentMessages[messageId - 1]) {
            sentMessages[messageId - 1].text = text;
          }
          return { ok: true, result: true };
        },
      },
    } as any;

    await probeBot.handleUserQuestion(mockCtx, "What's happening?");

    const text = sentMessages[0].text;
    expect(text).not.toContain('Follow up');
    expect(text).not.toContain('Follow-up');
    expect(text).toContain('Ask another question about ETH.');
  });

  // Requirement 5: Insufficient evidence produces a concise result, not an investigation questionnaire
  it('5. renders concise result when evidence is insufficient without exposing internal planner questionnaire', async () => {
    manager.createInvestigation({
      telegramChatId: 777,
      token: {
        address: '0x1234567890123456789012345678901234567890',
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const mockCtx = {
      chat: { id: 777 },
      from: { id: 777 },
      reply: async (text: string) => {
        const msgId = sentMessages.length + 1;
        sentMessages.push({ chatId: 777, text });
        return { message_id: msgId, chat: { id: 777 }, text };
      },
      api: {
        editMessageText: async (_chatId: number | string, messageId: number, text: string) => {
          if (sentMessages[messageId - 1]) {
            sentMessages[messageId - 1].text = text;
          }
          return { ok: true, result: true };
        },
      },
    } as any;

    await probeBot.handleUserQuestion(mockCtx, 'Check unknown coin activity');

    expect(sentMessages).toHaveLength(1);
    const text = sentMessages[0].text;
    expect(text).toContain("I couldn't establish a reliable explanation from the available on-chain data.");
    expect(text).toContain('Ask another question about UNKNOWN.');
    expect(text).not.toContain('Would you like to retrieve baseline token information');
    expect(text).not.toContain('Should we inspect cohort net flows');
    expect(text).not.toContain('Follow up');
    expect(text).not.toContain('Unknown');
  });

  // Requirement 6 & 7: Active token context is preserved and natural-language questions use it
  it('6 & 7. preserves active token context and natural-language questions use it without repeating token', async () => {
    const bot = probeBot.getBot();

    // 1. Establish active token SOL
    await bot.handleUpdate({
      update_id: 301,
      message: {
        message_id: 401,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 888, type: 'private' },
        from: { id: 888, is_bot: false, first_name: 'Charlie' },
        text: 'SOL',
      },
    });

    expect(manager.getActiveInvestigationByChatId(888)?.token.symbol).toBe('SOL');

    // 2. Ask natural language question without repeating token name
    await bot.handleUpdate({
      update_id: 302,
      message: {
        message_id: 402,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 888, type: 'private' },
        from: { id: 888, is_bot: false, first_name: 'Charlie' },
        text: 'Who is buying?',
      },
    });

    expect(orchestratorMock.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 888,
        question: 'Who is buying?',
        token: expect.objectContaining({ symbol: 'SOL' }),
      })
    );
  });

  // Requirement 9: Unsupported questions only receive a limitation when necessary
  it('9. only mentions limitations when the user asks an unsupported question (e.g. price prediction)', async () => {
    manager.createInvestigation({
      telegramChatId: 777,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const mockCtx = {
      chat: { id: 777 },
      from: { id: 777 },
      reply: async (text: string) => {
        const msgId = sentMessages.length + 1;
        sentMessages.push({ chatId: 777, text });
        return { message_id: msgId, chat: { id: 777 }, text };
      },
      api: {
        editMessageText: async (_chatId: number | string, messageId: number, text: string) => {
          if (sentMessages[messageId - 1]) {
            sentMessages[messageId - 1].text = text;
          }
          return { ok: true, result: true };
        },
      },
    } as any;

    // 1. Normal question: does NOT mention limitation
    await probeBot.handleUserQuestion(mockCtx, "What's happening?");
    expect(sentMessages[0].text).not.toContain("can't verify future price predictions");

    // 2. Speculative price prediction: produces concise limitation
    await probeBot.handleUserQuestion(mockCtx, 'Will ETH hit $10,000 next month?');
    expect(sentMessages[1].text).toContain("I can't verify future price predictions from on-chain evidence.");
    expect(sentMessages[1].text).toContain('I can investigate the on-chain activity instead.');
  });

  // Requirement 10: No direct Nansen calls are introduced into Telegram
  it('10. Telegram bot adapter does not import or call Nansen client directly', () => {
    // Inspect probeBot prototype and dependencies
    const botProto = Object.getPrototypeOf(probeBot);
    expect((probeBot as any).nansenClient).toBeUndefined();
    expect((probeBot as any).nansen).toBeUndefined();
    // Bot depends strictly on orchestrator and investigationManager
    expect((probeBot as any).orchestrator).toBeDefined();
    expect((probeBot as any).investigationManager).toBeDefined();
  });
});

