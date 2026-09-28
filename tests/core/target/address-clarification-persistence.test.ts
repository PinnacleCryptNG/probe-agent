import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TargetResolver } from '../../../src/core/target/target-resolver.js';
import { TokenResolver } from '../../../src/core/token/resolver.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { MockLLMProvider } from '../../../src/core/llm/interface.js';
import { EvidenceExecutor } from '../../../src/core/evidence/executor.js';
import { EvidenceSynthesisEngine } from '../../../src/core/synthesis/synthesizer.js';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { WalletTarget, TokenTarget } from '../../../src/core/target/types.js';

const MOCK_BOT_INFO = {
  id: 123456789,
  is_bot: true,
  first_name: 'PROBE Test Bot',
  username: 'probe_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

describe('PROBE — Address Clarification Persistence & Invalid Chain Regression Suite', () => {
  const ROBINHOOD_ADDRESS = '0xdDDF7AB756C35b4d0537825497e6932780710241';
  const PEPE_ADDRESS = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

  let tokenResolver: TokenResolver;
  let targetResolver: TargetResolver;
  let manager: InvestigationManager;
  let planner: InvestigationPlanner;
  let orchestrator: InvestigationOrchestrator;
  let probeBot: ProbeTelegramBot;
  let sentMessages: Array<{ chatId: number | string; text: string }>;

  beforeEach(() => {
    tokenResolver = new TokenResolver();
    targetResolver = new TargetResolver(tokenResolver);
    manager = new InvestigationManager();
    const registry = new CapabilityRegistry();
    planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: new MockLLMProvider(),
    });
    const executor = new EvidenceExecutor({} as any, registry);
    const synthesizer = new EvidenceSynthesisEngine({ llmProvider: new MockLLMProvider() });
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
      return { ok: true, result: {} } as never;
    });
  });

  // =========================================================================
  // SEQUENCE A: raw address -> pending chain clarification
  // =========================================================================
  it('A. raw address creates pending chain clarification and asks which chain', async () => {
    const chatId = 10001;

    const res = await targetResolver.resolve({
      question: ROBINHOOD_ADDRESS,
      chatId,
    });

    expect(res.status).toBe('AMBIGUOUS');
    expect(res.candidateIdentifier?.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
    expect(res.availableChains).toEqual([
      'Ethereum',
      'Base',
      'BNB',
      'Arbitrum',
      'Polygon',
      'Optimism',
    ]);
    expect(res.clarificationMessage).toContain('🔎 Address detected');
    expect(res.clarificationMessage).toContain('0xdddf...0241');
    expect(res.clarificationMessage).toContain(
      'I need to determine whether this address is a wallet or contract before investigating it.'
    );
    expect(res.clarificationMessage).toContain('Which chain?');
    expect(res.clarificationMessage).toContain('• Ethereum');
    expect(res.clarificationMessage).toContain('• Base');
    expect(res.clarificationMessage).toContain('• BNB');
    expect(res.clarificationMessage).toContain('• Arbitrum');
    expect(res.clarificationMessage).toContain('• Polygon');
    expect(res.clarificationMessage).toContain('• Optimism');

    const pending = targetResolver.getPendingResolution(chatId);
    expect(pending).toBeDefined();
    expect(pending?.type).toBe('address_chain_clarification');
    expect((pending as any)?.address.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
    expect((pending as any)?.awaiting).toBe('chain');
  });

  // =========================================================================
  // SEQUENCE B: raw address -> "Robinhood" -> still pending same address
  // =========================================================================
  it('B. raw address -> "Robinhood" -> invalid-chain message with chain choices and preserves address', async () => {
    const chatId = 10002;

    // Step 1: Raw address
    await targetResolver.resolve({
      question: ROBINHOOD_ADDRESS,
      chatId,
    });

    // Step 2: User sends "Robinhood" (an unrecognized chain)
    const turn2 = await targetResolver.resolve({
      question: 'Robinhood',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn2.status).toBe('AMBIGUOUS');
    expect(turn2.candidateIdentifier?.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
    expect(turn2.clarificationMessage).toBe(
      [
        '🔎 Address detected',
        '',
        '0xdddf...0241',
        '',
        'I don\'t recognize "Robinhood" as a supported chain.',
        '',
        'Which chain?',
        '• Ethereum',
        '• Base',
        '• BNB',
        '• Arbitrum',
        '• Polygon',
        '• Optimism',
      ].join('\n')
    );

    // Pending address MUST still be preserved
    const pendingStill = targetResolver.getPendingResolution(chatId);
    expect(pendingStill).toBeDefined();
    expect(pendingStill?.type).toBe('address_chain_clarification');
    expect((pendingStill as any)?.address.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
    expect((pendingStill as any)?.awaiting).toBe('chain');
  });

  // =========================================================================
  // SEQUENCE C: raw address -> "Robinhood" -> "Ethereum" -> resolves address
  // =========================================================================
  it('C. raw address -> "Robinhood" -> "Ethereum" -> original address resolves as wallet', async () => {
    const chatId = 10003;

    // Step 1: Raw address
    await targetResolver.resolve({
      question: ROBINHOOD_ADDRESS,
      chatId,
    });

    // Step 2: User sends "Robinhood"
    await targetResolver.resolve({
      question: 'Robinhood',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    // Step 3: User sends "Ethereum"
    const turn3 = await targetResolver.resolve({
      question: 'Ethereum',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn3.status).toBe('RESOLVED');
    expect(turn3.target.type).toBe('wallet');
    const walletTarget = turn3.target as WalletTarget;
    expect(walletTarget.address.toLowerCase()).toBe(ROBINHOOD_ADDRESS.toLowerCase());
    expect(walletTarget.chain).toBe('ethereum');

    // Pending state cleared after resolution
    expect(targetResolver.getPendingResolution(chatId)).toBeUndefined();
  });

  it('C2. raw token address -> "Robinhood" -> "Ethereum" -> resolves as verified TOKEN target', async () => {
    const chatId = 10004;

    // Step 1: Raw token address (PEPE)
    await targetResolver.resolve({
      question: PEPE_ADDRESS,
      chatId,
    });

    // Step 2: "Robinhood"
    await targetResolver.resolve({
      question: 'Robinhood',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    // Step 3: "Ethereum" -> classified as TOKEN because it is an indexed token contract
    const turn3 = await targetResolver.resolve({
      question: 'Ethereum',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn3.status).toBe('RESOLVED');
    expect(turn3.target.type).toBe('token');
    const tokenTarget = turn3.target as TokenTarget;
    expect(tokenTarget.token.symbol).toBe('PEPE');
    expect(tokenTarget.token.address.toLowerCase()).toBe(PEPE_ADDRESS.toLowerCase());
    expect(tokenTarget.chain).toBe('ethereum');
  });

  // =========================================================================
  // SEQUENCE D: raw address -> invalid chain -> "$PEPE" (explicit new target)
  // Decision: Explicit new target indicator (e.g. "$PEPE", new 0x address, tx)
  // replaces the pending address rather than falling through or erroring.
  // =========================================================================
  it('D. raw address -> invalid chain -> "$PEPE" -> replaces pending address with new target', async () => {
    const chatId = 10005;

    // Step 1: Raw address
    await targetResolver.resolve({
      question: ROBINHOOD_ADDRESS,
      chatId,
    });

    // Step 2: Invalid chain "Robinhood"
    await targetResolver.resolve({
      question: 'Robinhood',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    // Step 3: User sends explicit new token target "$PEPE"
    const turn3 = await targetResolver.resolve({
      question: '$PEPE',
      chatId,
      pendingResolution: targetResolver.getPendingResolution(chatId),
    });

    expect(turn3.status).toBe('RESOLVED');
    expect(turn3.target.type).toBe('token');
    const tokenTarget = turn3.target as TokenTarget;
    expect(tokenTarget.token.symbol).toBe('PEPE');
    expect(tokenTarget.chain).toBe('ethereum');

    // The old address is no longer pending
    expect(targetResolver.getPendingResolution(chatId)).toBeUndefined();
  });

  // =========================================================================
  // SEQUENCE E: Telegram Bot flow MUST NOT produce "Which token would you like to investigate?"
  // =========================================================================
  it('E. Telegram Bot flow: raw address -> "Robinhood" -> "Ethereum" never asks "Which token would you like to investigate?"', async () => {
    const bot = probeBot.getBot();
    const chatId = 10006;

    // Message 1: User sends raw address
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Alice' },
        text: ROBINHOOD_ADDRESS,
      },
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain('🔎 Address detected');
    expect(sentMessages[0].text).toContain('0xdddf...0241');
    expect(sentMessages[0].text).toContain('Which chain?');

    // Message 2: User responds "Robinhood"
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Alice' },
        text: 'Robinhood',
      },
    });

    expect(sentMessages.length).toBe(2);
    // MUST NOT send "Which token would you like to investigate?"
    expect(sentMessages[1].text).not.toContain('Which token would you like to investigate?');
    expect(sentMessages[1].text).toContain('🔎 Address detected');
    expect(sentMessages[1].text).toContain('0xdddf...0241');
    expect(sentMessages[1].text).toContain('I don\'t recognize "Robinhood" as a supported chain.');
    expect(sentMessages[1].text).toContain('Which chain?');
    expect(sentMessages[1].text).toContain('• Ethereum');

    // Message 3: User responds "Ethereum"
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Alice' },
        text: 'Ethereum',
      },
    });

    expect(sentMessages.length).toBe(3);
    // MUST NOT send generic token missing message
    expect(sentMessages[2].text).not.toContain('Which token would you like to investigate?');
    // Must acknowledge wallet investigation
    expect(sentMessages[2].text).toContain('🔎 WALLET INVESTIGATION');
    expect(sentMessages[2].text).toContain('0xdddf...0241 · Ethereum');
    expect(sentMessages[2].text).toContain('What would you like to investigate about this wallet?');
  });

  it('E2. Telegram Bot flow: raw address -> "Ethereum" directly starts WALLET INVESTIGATION without asking which token', async () => {
    const bot = probeBot.getBot();
    const chatId = 10007;

    // Message 1: Raw address
    await bot.handleUpdate({
      update_id: 10,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Alice' },
        text: ROBINHOOD_ADDRESS,
      },
    });

    // Message 2: "Ethereum"
    await bot.handleUpdate({
      update_id: 11,
      message: {
        message_id: 11,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'Alice' },
        text: 'Ethereum',
      },
    });

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[1].text).not.toContain('Which token would you like to investigate?');
    expect(sentMessages[1].text).toContain('🔎 WALLET INVESTIGATION');
    expect(sentMessages[1].text).toContain('0xdddf...0241 · Ethereum');
  });
});
