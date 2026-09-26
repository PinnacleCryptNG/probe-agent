import { describe, expect, it, vi } from 'vitest';
import { UserFromGetMe } from 'grammy/types';
import {
  extractTokenCandidate,
  detectTokenCandidate,
  isEvmAddress,
  isSolanaAddress,
  isOnlyTokenInput,
} from '../../../src/core/token/detector.js';
import { TokenResolver } from '../../../src/core/token/resolver.js';
import { INansenClient } from '../../../src/core/nansen/client.js';
import { InvestigationPlanner } from '../../../src/core/planner/planner.js';
import { CapabilityRegistry } from '../../../src/core/capabilities/registry.js';
import { CAPABILITY_CHAIN_SUPPORT, isCapabilitySupportedOnChain } from '../../../src/core/capabilities/chain-support.js';
import { ProbeTelegramBot } from '../../../src/adapters/telegram/bot.js';
import { InvestigationManager } from '../../../src/core/investigation/manager.js';
import { InvestigationOrchestrator } from '../../../src/core/investigation/orchestrator.js';

const SOLANA_TARGET_CONTRACT = '3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDupmp';

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

describe('Solana Multichain Token Resolution Regression (3znS89gifim2Hhhu8wjb2PfSgaCDdma187D5NMkDupmp)', () => {
  // 1. Telegram accepts it as an address candidate
  it('1. accepts input as an address candidate from Telegram text input', () => {
    const candidate = extractTokenCandidate(SOLANA_TARGET_CONTRACT);

    expect(candidate).toBeDefined();
    expect(candidate?.identifier).toBe(SOLANA_TARGET_CONTRACT);
    expect(candidate?.type).toBe('address');
  });

  // 2. The candidate is recognized as potentially Solana-compatible
  it('2. recognizes candidate as potentially Solana-compatible', () => {
    const detected = detectTokenCandidate(SOLANA_TARGET_CONTRACT);

    expect(detected).toBeDefined();
    expect(detected?.detectedChain).toBe('solana');
    expect(isSolanaAddress(SOLANA_TARGET_CONTRACT)).toBe(true);
  });

  // 3. It reaches token resolution
  it('3. candidate reaches TokenResolver and triggers resolution logic', async () => {
    const mockNansenClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Buttbrain',
              symbol: 'BRAIN',
              chain: 'solana',
              address: SOLANA_TARGET_CONTRACT,
              decimals: 6,
            },
          ],
        },
        metadata: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockNansenClient });
    const candidate = extractTokenCandidate(SOLANA_TARGET_CONTRACT)!;

    const resolved = await resolver.resolve(candidate);

    expect(mockNansenClient.searchGeneral).toHaveBeenCalledTimes(1);
    expect(mockNansenClient.searchGeneral).toHaveBeenCalledWith(
      expect.objectContaining({
        search_query: SOLANA_TARGET_CONTRACT,
      })
    );
    expect(resolved).not.toBeNull();
  });

  // 4. It is NOT rejected by an EVM-only address regex
  it('4. is NOT rejected by an EVM-only address regex or treated as invalid', () => {
    // EVM regex fails, but Solana regex succeeds
    expect(isEvmAddress(SOLANA_TARGET_CONTRACT)).toBe(false);
    expect(isSolanaAddress(SOLANA_TARGET_CONTRACT)).toBe(true);

    const isStandalone = isOnlyTokenInput(SOLANA_TARGET_CONTRACT);
    expect(isStandalone).toBe(true);

    // Extraction should succeed without error
    const candidate = extractTokenCandidate(SOLANA_TARGET_CONTRACT);
    expect(candidate).toBeDefined();
    expect(candidate?.type).toBe('address');
  });

  // 5. If Nansen resolves it, the resolved token contains chain=solana
  it('5. resolves into TokenContext containing chain=solana and correct token metadata', async () => {
    const mockNansenClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Buttbrain',
              symbol: 'BRAIN',
              chain: 'solana',
              address: SOLANA_TARGET_CONTRACT,
              decimals: 6,
            },
          ],
        },
        metadata: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const resolver = new TokenResolver({ nansenClient: mockNansenClient });
    const resolved = await resolver.resolve(SOLANA_TARGET_CONTRACT);

    expect(resolved).toBeDefined();
    expect(resolved?.chain).toBe('solana');
    expect(resolved?.address).toBe(SOLANA_TARGET_CONTRACT);
    expect(resolved?.symbol).toBe('BRAIN');
    expect(resolved?.name).toBe('Buttbrain');
    expect(resolved?.decimals).toBe(6);
  });

  // 6. The planner receives the resolved Solana token
  it('6. passes the resolved Solana token to InvestigationPlanner without failure', async () => {
    const registry = new CapabilityRegistry();
    const planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: {
        generateStructured: vi.fn(),
        generateInvestigationPlan: vi.fn(),
        synthesizeEvidence: vi.fn(),
      },
    });

    const solanaToken = {
      address: SOLANA_TARGET_CONTRACT,
      symbol: 'BRAIN',
      name: 'Buttbrain',
      chain: 'solana',
      decimals: 6,
      resolvedAt: new Date().toISOString(),
    };

    const plan = await planner.plan(
      { token: solanaToken },
      "What's happening?"
    );

    expect(plan).toBeDefined();
    expect(plan.tokenContext.chain).toBe('solana');
    expect(plan.tokenContext.address).toBe(SOLANA_TARGET_CONTRACT);
    expect(plan.selectedCapabilities.length).toBeGreaterThan(0);
  });

  // 7. Unsupported capabilities are filtered out rather than causing token rejection
  it('7. filters out unsupported capabilities rather than causing token rejection', async () => {
    // Verify capability support model
    expect(isCapabilitySupportedOnChain('flow_intelligence', 'solana')).toBe(true);
    expect(isCapabilitySupportedOnChain('wallet_transactions', 'solana')).toBe(false);
    expect(isCapabilitySupportedOnChain('wallet_related', 'solana')).toBe(false);

    const registry = new CapabilityRegistry();
    const planner = new InvestigationPlanner({
      capabilityRegistry: registry,
      llmProvider: {
        generateStructured: vi.fn(),
        generateInvestigationPlan: vi.fn(),
        synthesizeEvidence: vi.fn(),
      },
    });

    const solanaToken = {
      address: SOLANA_TARGET_CONTRACT,
      symbol: 'BRAIN',
      name: 'Buttbrain',
      chain: 'solana',
      resolvedAt: new Date().toISOString(),
    };

    // A question that targets general activity
    const plan = await planner.plan(
      { token: solanaToken },
      "Who is buying?"
    );

    // Should select compatible capabilities (e.g. who_bought_sold, flow_intelligence)
    for (const capName of plan.selectedCapabilities) {
      expect(registry.isChainSupported(capName, 'solana')).toBe(true);
    }
    // Should NOT have selected wallet_transactions or wallet_related
    expect(plan.selectedCapabilities).not.toContain('wallet_transactions');
    expect(plan.selectedCapabilities).not.toContain('wallet_related');
  });

  // End-to-end Telegram bot interaction with the Solana address
  it('8. Telegram bot accepts the Solana contract, resolves it, and prompts user for investigation', async () => {
    const mockNansenClient: INansenClient = {
      searchGeneral: vi.fn().mockResolvedValue({
        data: {
          tokens: [
            {
              name: 'Buttbrain',
              symbol: 'BRAIN',
              chain: 'solana',
              address: SOLANA_TARGET_CONTRACT,
              decimals: 6,
            },
          ],
        },
        metadata: { creditsCost: 0, creditsUsed: 0, creditsRemaining: 1000, durationMs: 5 },
      }),
    } as unknown as INansenClient;

    const tokenResolver = new TokenResolver({ nansenClient: mockNansenClient });
    const manager = new InvestigationManager();
    const orchestratorMock = {
      executeTurn: vi.fn(),
    } as unknown as InvestigationOrchestrator;

    const probeBot = new ProbeTelegramBot({
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      orchestrator: orchestratorMock,
      investigationManager: manager,
      tokenResolver,
    });

    const bot = probeBot.getBot();
    bot.botInfo = MOCK_BOT_INFO;

    const replies: Array<{ text: string; options?: Record<string, unknown> }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'sendMessage') {
        const p = payload as { text: string; chat_id: number };
        replies.push(p);
        return {
          ok: true,
          result: {
            message_id: replies.length,
            date: Math.floor(Date.now() / 1000),
            chat: { id: p.chat_id, type: 'private' },
            text: p.text,
          },
        } as never;
      }
      return { ok: true, result: {} } as never;
    });

    // User submits Solana address directly
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 7777, type: 'private' },
        from: { id: 7777, is_bot: false, first_name: 'SolUser' },
        text: SOLANA_TARGET_CONTRACT,
      },
    });

    expect(replies).toHaveLength(1);
    const replyText = replies[0].text;

    // Must NOT be "I couldn't identify that token"
    expect(replyText).not.toContain("I couldn't identify that token");

    // Must be the token confirmation:
    // 🔎 BRAIN
    // What do you want to investigate?
    expect(replyText).toContain('🔎 BRAIN');
    expect(replyText).toContain('What do you want to investigate?');

    // Active investigation context should now be established on Solana
    const active = manager.getActiveInvestigationByChatId(7777);
    expect(active).toBeDefined();
    expect(active?.token.chain).toBe('solana');
    expect(active?.token.symbol).toBe('BRAIN');
    expect(active?.token.address).toBe(SOLANA_TARGET_CONTRACT);
  });
});
