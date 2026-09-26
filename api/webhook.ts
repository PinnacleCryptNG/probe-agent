import type { IncomingMessage, ServerResponse } from 'node:http';
import { webhookCallback } from 'grammy';
import type { Update } from 'grammy/types';
import { getOrInitRuntime } from '../src/index.js';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface VercelLikeRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[]>;
}

export interface VercelLikeResponse extends ServerResponse {
  status?: (statusCode: number) => VercelLikeResponse;
  json?: (body: unknown) => void;
  send?: (body: unknown) => void;
}

/**
 * Custom grammY serverless adapter for Vercel Node.js runtime.
 * Handles pre-parsed JSON bodies as well as streaming payloads.
 */
export function createVercelNodeAdapter(req: VercelLikeRequest, res: VercelLikeResponse) {
  const secretHeader =
    (req.headers[SECRET_HEADER] as string | undefined) ??
    (req.headers['X-Telegram-Bot-Api-Secret-Token'] as string | undefined);

  return {
    get update(): Promise<Update> {
      if (req.body && typeof req.body === 'object') {
        return Promise.resolve(req.body as Update);
      }
      return new Promise<Update>((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk: Buffer | string) => {
          raw += chunk.toString();
        });
        req.once('end', () => {
          try {
            resolve(raw ? (JSON.parse(raw) as Update) : ({} as Update));
          } catch (err) {
            reject(err);
          }
        });
        req.once('error', reject);
      });
    },
    header: secretHeader,
    end: () => {
      if (!res.writableEnded) {
        res.end();
      }
    },
    respond: (json: string) => {
      if (!res.writableEnded) {
        res.setHeader('Content-Type', 'application/json');
        res.end(json);
      }
    },
    unauthorized: () => {
      if (!res.writableEnded) {
        if (typeof res.status === 'function') {
          res.status(401);
        } else {
          res.statusCode = 401;
        }
        res.end('Unauthorized');
      }
    },
    handlerReturn: undefined,
  };
}

let cachedHandler: ((...args: unknown[]) => Promise<unknown>) | null = null;

export async function getWebhookHandler(): Promise<(...args: unknown[]) => Promise<unknown>> {
  if (cachedHandler) {
    return cachedHandler;
  }

  const runtime = await getOrInitRuntime({ skipPolling: true });
  const bot = runtime.bot.getBot();
  const env = getEnv();
  const secretToken = env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;

  // Create unified handler supporting both Node (req, res) and Web standard Request
  const nodeCallback = webhookCallback(bot, createVercelNodeAdapter, {
    secretToken,
    onTimeout: 'return',
    timeoutMilliseconds: 55000,
  });

  const stdCallback = webhookCallback(bot, 'std/http', {
    secretToken,
    onTimeout: 'return',
    timeoutMilliseconds: 55000,
  });

  function extractSecretHeader(incoming: unknown): string | undefined {
    if (!incoming || typeof incoming !== 'object') {
      return undefined;
    }
    const candidate = incoming as { headers?: Headers | Record<string, string | string[] | undefined> };
    if (!candidate.headers) {
      return undefined;
    }
    if (typeof (candidate.headers as Headers).get === 'function') {
      const h = candidate.headers as Headers;
      return h.get(SECRET_HEADER) ?? h.get('X-Telegram-Bot-Api-Secret-Token') ?? undefined;
    }
    const record = candidate.headers as Record<string, string | string[] | undefined>;
    const val = record[SECRET_HEADER] ?? record['X-Telegram-Bot-Api-Secret-Token'];
    return Array.isArray(val) ? val[0] : val;
  }

  function verifySecretToken(
    providedSecret: string | undefined,
    expectedSecret: string | undefined
  ): boolean {
    if (!expectedSecret || expectedSecret.trim() === '') {
      return true;
    }
    if (!providedSecret) {
      return false;
    }
    return providedSecret.trim() === expectedSecret.trim();
  }

  cachedHandler = async (...args: unknown[]) => {
    const firstArg = args[0];

    // Check if called with Web Standard Request (Fetch API / Edge)
    if (
      firstArg instanceof Request ||
      (firstArg && typeof (firstArg as { arrayBuffer?: unknown }).arrayBuffer === 'function')
    ) {
      const req = firstArg as Request;
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      if (!verifySecretToken(extractSecretHeader(req), secretToken)) {
        logger.warn('Unauthorized webhook request: secret token mismatch or missing');
        return new Response('Unauthorized', { status: 401 });
      }

      return stdCallback(req);
    }

    // Standard Node.js / Vercel Serverless Function (req, res)
    const req = args[0] as VercelLikeRequest;
    const res = args[1] as VercelLikeResponse;

    if (req.method !== 'POST') {
      if (typeof res.status === 'function') {
        res.status(405);
      } else {
        res.statusCode = 405;
      }
      res.end('Method Not Allowed');
      return;
    }

    if (!verifySecretToken(extractSecretHeader(req), secretToken)) {
      logger.warn('Unauthorized webhook request: secret token mismatch or missing');
      if (typeof res.status === 'function') {
        res.status(401);
      } else {
        res.statusCode = 401;
      }
      res.end('Unauthorized');
      return;
    }

    return nodeCallback(req, res);
  };

  return cachedHandler;
}

/**
 * Resets the cached webhook handler (useful for testing).
 */
export function resetCachedWebhookHandler(): void {
  cachedHandler = null;
}

/**
 * Vercel Serverless Function entrypoint.
 * Handles incoming Telegram webhook updates and executes them through Probe Core.
 */
export default async function handler(
  req: VercelLikeRequest | Request,
  res?: VercelLikeResponse
): Promise<unknown> {
  try {
    const webhookHandler = await getWebhookHandler();
    return await webhookHandler(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Unhandled error in Telegram webhook handler', { error: msg });

    if (res && typeof res.end === 'function') {
      if (!res.writableEnded) {
        if (typeof res.status === 'function') res.status(500);
        else res.statusCode = 500;
        res.end('Internal Server Error');
      }
      return;
    }

    return new Response('Internal Server Error', { status: 500 });
  }
}

// Named export for Web Standard POST handler
export async function POST(req: Request): Promise<Response> {
  return (await handler(req)) as Response;
}
