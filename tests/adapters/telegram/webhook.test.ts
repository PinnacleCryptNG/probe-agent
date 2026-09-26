import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import handler, {
  getWebhookHandler,
  resetCachedWebhookHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../../../api/webhook.js';
import { getOrInitRuntime, resetCachedRuntime } from '../../../src/index.js';
import { loadEnv } from '../../../src/config/env.js';

describe('Vercel Telegram Webhook Handler (Phase 5C / Step 2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.restoreAllMocks();
    resetCachedWebhookHandler();
    await resetCachedRuntime();

    process.env.NODE_ENV = 'test';
    process.env.TELEGRAM_BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    process.env.NANSEN_API_KEY = 'test_nansen_key';
    process.env.LLM_PROVIDER = 'mock';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test_webhook_secret_123';
    loadEnv();

    const runtime = await getOrInitRuntime({ isTest: true, skipPolling: true });
    runtime.bot.getBot().botInfo = {
      id: 123456,
      is_bot: true,
      first_name: 'ProbeBot',
      username: 'probe_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    };
  });

  afterEach(async () => {
    resetCachedWebhookHandler();
    await resetCachedRuntime();
    process.env = { ...originalEnv };
  });

  describe('1. Webhook Endpoint Initialization & Runtime Reuse', () => {
    it('initializes the webhook handler without starting polling', async () => {
      const runtime = await getOrInitRuntime({ isTest: true, skipPolling: true });
      expect(runtime).toBeDefined();
      expect(runtime.bot).toBeDefined();

      const webhookHandler = await getWebhookHandler();
      expect(typeof webhookHandler).toBe('function');
    });

    it('reuses the cached runtime across multiple invocations', async () => {
      const runtime1 = await getOrInitRuntime({ isTest: true, skipPolling: true });
      const runtime2 = await getOrInitRuntime({ isTest: true, skipPolling: true });

      // Verifies exact reference equality across invocations (warm instance reuse)
      expect(runtime1).toBe(runtime2);
    });

    it('reuses the cached webhook handler', async () => {
      const handler1 = await getWebhookHandler();
      const handler2 = await getWebhookHandler();

      expect(handler1).toBe(handler2);
    });
  });

  describe('2. Method Not Allowed (Non-POST Requests)', () => {
    it('rejects GET requests with HTTP 405 when called via Web Request', async () => {
      const req = new Request('https://probe-agent.vercel.app/api/webhook', {
        method: 'GET',
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(405);
      const text = await res.text();
      expect(text).toContain('Method Not Allowed');
    });

    it('rejects GET requests with HTTP 405 when called via Node req/res', async () => {
      const req: VercelLikeRequest = {
        method: 'GET',
        headers: {},
      } as unknown as VercelLikeRequest;

      let statusCode = 200;
      let responseBody = '';

      const res: VercelLikeResponse = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        end(data?: unknown) {
          if (data) responseBody = String(data);
        },
      } as unknown as VercelLikeResponse;

      await handler(req, res);
      expect(statusCode).toBe(405);
      expect(responseBody).toContain('Method Not Allowed');
    });
  });

  describe('3. Webhook Secret Token Verification', () => {
    it('rejects request with HTTP 401 when secret token header is missing', async () => {
      const req = new Request('https://probe-agent.vercel.app/api/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ update_id: 1001 }),
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(401);
    });

    it('rejects request with HTTP 401 when secret token header is wrong', async () => {
      const req = new Request('https://probe-agent.vercel.app/api/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'wrong_secret_value',
        },
        body: JSON.stringify({ update_id: 1002 }),
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(401);
    });

    it('accepts request and returns HTTP 200 when secret token matches', async () => {
      // Set botInfo so grammY skips remote getMe during unit testing
      const runtime = await getOrInitRuntime({ isTest: true, skipPolling: true });
      runtime.bot.getBot().botInfo = {
        id: 123456,
        is_bot: true,
        first_name: 'ProbeBot',
        username: 'probe_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      const req = new Request('https://probe-agent.vercel.app/api/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test_webhook_secret_123',
        },
        body: JSON.stringify({
          update_id: 1003,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 999999, type: 'private' },
            from: { id: 999999, is_bot: false, first_name: 'Tester' },
            text: '/help',
          },
        }),
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(200);
    });

    it('handles Node-style req/res with valid secret token', async () => {
      const runtime = await getOrInitRuntime({ isTest: true, skipPolling: true });
      runtime.bot.getBot().botInfo = {
        id: 123456,
        is_bot: true,
        first_name: 'ProbeBot',
        username: 'probe_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      const req: VercelLikeRequest = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test_webhook_secret_123',
        },
        body: {
          update_id: 1004,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 999999, type: 'private' },
            from: { id: 999999, is_bot: false, first_name: 'Tester' },
            text: '/help',
          },
        },
      } as unknown as VercelLikeRequest;

      let statusCode = 200;
      const res: VercelLikeResponse = {
        statusCode: 200,
        setHeader() {},
        status(code: number) {
          statusCode = code;
          return this;
        },
        end() {},
      } as unknown as VercelLikeResponse;

      await handler(req, res);
      expect(statusCode).toBe(200);
    });
  });

  describe('4. Optional Secret (When Unconfigured)', () => {
    it('allows requests through if TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      loadEnv();
      resetCachedWebhookHandler();

      const runtime = await getOrInitRuntime({ isTest: true, skipPolling: true });
      runtime.bot.getBot().botInfo = {
        id: 123456,
        is_bot: true,
        first_name: 'ProbeBot',
        username: 'probe_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      };

      const req = new Request('https://probe-agent.vercel.app/api/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          update_id: 1005,
          message: {
            message_id: 3,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 999999, type: 'private' },
            from: { id: 999999, is_bot: false, first_name: 'Tester' },
            text: '/help',
          },
        }),
      });

      const res = (await handler(req)) as Response;
      expect(res.status).toBe(200);
    });
  });
});
