import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFromGetMe } from 'grammy/types';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationTurnResult } from '../../../src/core/investigation/types.js';
import { TelegramProgressTracker } from '../../../src/adapters/telegram/progress.js';

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

describe('Telegram Investigation Progress Feedback Tests', () => {
  let manager: InvestigationManager;
  let orchestratorMock: InvestigationOrchestrator;
  let probeBot: ProbeTelegramBot;
  let sentMessages: Array<{ chatId: number | string; text: string; messageId: number }>;
  let editedMessages: Array<{ chatId: number | string; messageId: number; text: string }>;
  let progressStagesSeen: string[];

  beforeEach(() => {
    manager = new InvestigationManager();
    sentMessages = [];
    editedMessages = [];
    progressStagesSeen = [];

    orchestratorMock = {
      executeTurn: vi.fn().mockImplementation(async (req) => {
        // Simulate progressive stage notifications from orchestrator
        if (req.onProgress) {
          await req.onProgress('token_identified');
          progressStagesSeen.push('token_identified');

          await req.onProgress('activity_analyzed');
          progressStagesSeen.push('activity_analyzed');

          await req.onProgress('building_report');
          progressStagesSeen.push('building_report');
        }

        return {
          investigationId: 'inv_progress_123',
          turnId: 'turn_progress_1',
          status: 'completed',
          question: req.question,
          token: req.token,
          evidence: [],
          synthesis: {
            success: true,
            answer: 'Whales accumulated $12.4M ETH over the observed period.',
            observations: [
              {
                id: 'obs_1',
                statement: 'Whales accumulated $12.4M ETH over the observed period.',
                evidenceRefs: ['evi_1'],
              },
            ],
            interpretations: [
              {
                id: 'interp_1',
                statement: 'Evidence is consistent with institutional accumulation.',
                confidence: 'high',
                evidenceRefs: ['evi_1'],
              },
            ],
            hypotheses: [],
            unknowns: [],
            evidenceRefs: ['evi_1'],
            followUpQuestions: ['Did accumulation continue?'],
            validated: true,
            investigationId: 'inv_progress_123',
            createdAt: '2026-03-20T12:00:00.000Z',
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
        const messageId = sentMessages.length + 1;
        sentMessages.push({ chatId: p.chat_id, text: p.text, messageId });
        return {
          ok: true,
          result: {
            message_id: messageId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(p.chat_id), type: 'private' },
            text: p.text,
          },
        } as never;
      }
      if (method === 'editMessageText') {
        const p = payload as { chat_id: number | string; message_id: number; text: string };
        editedMessages.push({ chatId: p.chat_id, messageId: p.message_id, text: p.text });
        const target = sentMessages.find((m) => m.messageId === p.message_id);
        if (target) {
          target.text = p.text;
        }
        return { ok: true, result: true } as never;
      }
      if (method === 'answerCallbackQuery') {
        return { ok: true, result: true } as never;
      }
      return { ok: true, result: {} } as never;
    });
  });

  // 1. Progress message is sent immediately
  it('1. sends a temporary progress message immediately upon question submission', async () => {
    // Seed active token context
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 201,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: "What's happening?",
      },
    });

    // Check that an initial message was sent with "🔎 Investigating ETH..."
    expect(editedMessages.length).toBeGreaterThanOrEqual(3);
    // The initial message sent via sendMessage was the progress header:
    expect(editedMessages[0].text).toContain('🔎 Investigating ETH...');
    expect(editedMessages[0].text).toContain('✓ Token identified');
  });

  // 2. Progress message is edited during execution across all stages
  it('2. edits the progress message as investigation advances through pipeline stages', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 202,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: 'Who is buying?',
      },
    });

    // Verify all 3 stages were delivered
    expect(progressStagesSeen).toEqual(['token_identified', 'activity_analyzed', 'building_report']);

    // Check each edit:
    // Stage 1: Token identified
    expect(editedMessages[0].text).toBe('🔎 Investigating ETH...\n✓ Token identified');

    // Stage 2: Activity analyzed
    expect(editedMessages[1].text).toBe(
      '🔎 Investigating ETH...\n✓ Token identified\n✓ On-chain activity analyzed'
    );

    // Stage 3: Building report
    expect(editedMessages[2].text).toBe(
      '🔎 Investigating ETH...\n✓ Token identified\n✓ On-chain activity analyzed\n⏳ Building evidence report...'
    );
  });

  // 3. Final result replaces progress message
  it('3. replaces the progress message with the formatted investigation result upon completion', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 203,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: "What's happening?",
      },
    });

    // The final edit must be the formatted investigation report
    const lastEdit = editedMessages[editedMessages.length - 1];
    expect(lastEdit.text).toContain('🔎 ETH —');
    expect(lastEdit.text).toContain('Whales accumulated $12.4M ETH');
    expect(lastEdit.text).not.toContain('⏳ Building evidence report...');

    // The in-place sent message reflects the final text
    expect(sentMessages[0].text).toContain('🔎 ETH —');
    expect(sentMessages[0].text).toContain('Whales accumulated $12.4M ETH');
  });

  // 4. Errors replace progress message
  it('4. replaces the progress message with sanitized error message on failure', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    // Make orchestrator throw an unexpected error
    orchestratorMock.executeTurn = vi.fn().mockRejectedValue(new Error('Internal unexpected error'));

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 204,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: "What's happening?",
      },
    });

    // The progress message must have been edited into the sanitized error message
    const lastEdit = editedMessages[editedMessages.length - 1];
    expect(lastEdit.text).toBe('⚠️ An unexpected issue occurred during the investigation. Please try again.');
    expect(sentMessages[0].text).toBe('⚠️ An unexpected issue occurred during the investigation. Please try again.');
  });

  // 5. No duplicate progress messages (prefers editing one message)
  it('5. does not send multiple progress messages, preferring editing one Telegram message', async () => {
    manager.createInvestigation({
      telegramChatId: 12345,
      token: {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        symbol: 'ETH',
        name: 'Ethereum',
        chain: 'ethereum',
        resolvedAt: new Date().toISOString(),
      },
    });

    const bot = probeBot.getBot();

    await bot.handleUpdate({
      update_id: 5,
      message: {
        message_id: 205,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
        text: "What's happening?",
      },
    });

    // Exactly 1 message sent via sendMessage for the entire turn
    expect(sentMessages).toHaveLength(1);
    // All updates used editMessageText on message_id: 1
    for (const edit of editedMessages) {
      expect(edit.messageId).toBe(1);
    }
  });

  // 6. Direct TelegramProgressTracker unit test
  it('6. unit tests TelegramProgressTracker directly for formatting and state transitions', async () => {
    const replies: string[] = [];
    const edits: Array<{ id: number; text: string }> = [];

    const mockCtx = {
      reply: async (text: string) => {
        replies.push(text);
        return { message_id: 42, chat: { id: 999 } };
      },
      api: {
        editMessageText: async (_chatId: any, messageId: number, text: string) => {
          edits.push({ id: messageId, text });
          return { ok: true };
        },
      },
    } as any;

    const tracker = new TelegramProgressTracker({
      chatId: 999,
      tokenSymbol: 'SOL',
      ctx: mockCtx,
    });

    expect(tracker.getMessageId()).toBeUndefined();
    expect(tracker.isDone()).toBe(false);

    // Start
    await tracker.start();
    expect(tracker.getMessageId()).toBe(42);
    expect(replies[0]).toBe('🔎 Investigating SOL...');

    // Progress updates
    await tracker.updateStage('token_identified');
    expect(tracker.getCurrentStage()).toBe('token_identified');
    expect(edits[0]).toEqual({
      id: 42,
      text: '🔎 Investigating SOL...\n✓ Token identified',
    });

    await tracker.updateStage('activity_analyzed');
    expect(tracker.getCurrentStage()).toBe('activity_analyzed');
    expect(edits[1]).toEqual({
      id: 42,
      text: '🔎 Investigating SOL...\n✓ Token identified\n✓ On-chain activity analyzed',
    });

    await tracker.updateStage('building_report');
    expect(tracker.getCurrentStage()).toBe('building_report');
    expect(edits[2]).toEqual({
      id: 42,
      text: '🔎 Investigating SOL...\n✓ Token identified\n✓ On-chain activity analyzed\n⏳ Building evidence report...',
    });

    // Finish
    await tracker.finish(['Final Solana Report']);
    expect(tracker.isDone()).toBe(true);
    expect(edits[3]).toEqual({
      id: 42,
      text: 'Final Solana Report',
    });

    // Post-final updates are ignored
    await tracker.updateStage('token_identified');
    expect(edits).toHaveLength(4);
  });
});
