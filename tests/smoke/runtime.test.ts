import { describe, expect, it, vi } from 'vitest';
import { UserFromGetMe } from 'grammy/types';
import { bootstrap, validateRuntimeConfig } from '../../src/index.js';
import { loadEnv } from '../../src/config/env.js';

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

describe('Runtime Wiring Smoke Test (Phase 3B)', () => {
  it('1. validates runtime configuration and rejects missing tokens in production mode', () => {
    const env = loadEnv({
      TELEGRAM_BOT_TOKEN: 'dummy_telegram_token_for_testing',
      NANSEN_API_KEY: 'valid_nansen_key',
      LLM_PROVIDER: 'mock',
    });

    expect(() => validateRuntimeConfig(env, false)).toThrow('Missing TELEGRAM_BOT_TOKEN');
  });

  it('2. validates runtime configuration and rejects missing Nansen API key', () => {
    const env = loadEnv({
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      NANSEN_API_KEY: 'dummy_nansen_key_for_testing',
      LLM_PROVIDER: 'mock',
    });

    expect(() => validateRuntimeConfig(env, false)).toThrow('Missing NANSEN_API_KEY');
  });

  it('3. validates runtime configuration and rejects missing LLM API key when non-mock provider is selected', () => {
    const env = loadEnv({
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      NANSEN_API_KEY: 'valid_nansen_key',
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: '',
    });

    expect(() => validateRuntimeConfig(env, false)).toThrow("Missing LLM_API_KEY for provider 'openai'");
  });

  it('4. bootstraps complete dependency graph in-memory without errors', async () => {
    const runtime = await bootstrap({
      isTest: true,
      skipPolling: true,
      envOverrides: {
        TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        NANSEN_API_KEY: 'valid_test_nansen_key',
        LLM_PROVIDER: 'mock',
      },
    });

    expect(runtime).toBeDefined();
    expect(runtime.bot).toBeDefined();
    expect(runtime.orchestrator).toBeDefined();
    expect(runtime.investigationManager).toBeDefined();
    expect(runtime.dbClient).toBeDefined();

    // Clean shutdown
    await runtime.stop();
  });

  it('5. wires all real layers end-to-end and processes question through Telegram bot update', async () => {
    // Mock global fetch for Nansen client to guarantee completely offline execution
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      let responseBody: Record<string, unknown> = {
        data: {
          symbol: 'ETH',
          name: 'Ethereum',
          price_usd: 2500,
          market_cap_usd: 300000000000,
          volume_24h_usd: 15000000000,
        },
      };

      if (urlStr.includes('/search/general')) {
        responseBody = {
          data: {
            tokens: [
              {
                name: 'Ethereum',
                symbol: 'ETH',
                chain: 'ethereum',
                address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              },
            ],
          },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'x-nansen-credits-used': '1',
        }),
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      } as unknown as Response;
    });

    try {
      const runtime = await bootstrap({
        isTest: true,
        skipPolling: true,
        envOverrides: {
          TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          NANSEN_API_KEY: 'valid_test_nansen_key',
          LLM_PROVIDER: 'mock',
        },
      });

      const bot = runtime.bot.getBot();
      bot.botInfo = MOCK_BOT_INFO;

      const replies: string[] = [];

      // Intercept outgoing messages
      bot.api.config.use(async (_prev, method, payload) => {
        if (method === 'sendMessage') {
          const p = payload as { text: string; chat_id: number };
          replies.push(p.text);
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
        if (method === 'editMessageText') {
          const p = payload as { text: string; chat_id: number; message_id: number };
          if (replies[p.message_id - 1] !== undefined) {
            replies[p.message_id - 1] = p.text;
          } else {
            replies.push(p.text);
          }
          return { ok: true, result: {} } as never;
        }
        return { ok: true, result: {} } as never;
      });

      // 1. Send /start
      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 9999, type: 'private' },
          from: { id: 9999, is_bot: false, first_name: 'Tester' },
          text: '/start',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        },
      });

      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain('PROBE');

      // 2. Send natural-language question
      await bot.handleUpdate({
        update_id: 2,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 9999, type: 'private' },
          from: { id: 9999, is_bot: false, first_name: 'Tester' },
          text: 'Why is ETH activity changing?',
        },
      });

      expect(replies.length).toBeGreaterThanOrEqual(2);
      const lastReply = replies[replies.length - 1];
      expect(lastReply).toContain('🔎 ETH — Why is ETH activity changing?');
      expect(lastReply).toContain('• ');
      expect(lastReply).toContain('Ask another question about ETH.');
      expect(lastReply).not.toContain('Follow up');

      // Clean shutdown
      await runtime.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
