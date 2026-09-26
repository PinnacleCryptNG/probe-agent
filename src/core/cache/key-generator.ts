import { createHash } from 'node:crypto';

export interface CacheKeyParams {
  chain: string;
  token: string;
  capability: string;
  queryParams?: Record<string, unknown>;
}

/**
 * Deterministically sorts object keys deeply to guarantee identical hash output
 * regardless of key ordering.
 */
export function normalizeParams(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeParams);
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = normalizeParams((obj as Record<string, unknown>)[key]);
  }
  return result;
}

/**
 * Builds a canonical cache key incorporating chain, token, capability, and normalized parameters.
 * Format: probe:cache:{chain}:{token}:{capability}:{sha256}
 */
export function generateCacheKey(params: CacheKeyParams): string {
  const normalizedChain = params.chain.trim().toLowerCase();
  const normalizedToken = params.token.trim().toLowerCase();
  const normalizedCapability = params.capability.trim().toLowerCase();

  const sortedParams = normalizeParams(params.queryParams ?? {});
  const serialized = JSON.stringify(sortedParams);

  const hash = createHash('sha256').update(serialized).digest('hex').slice(0, 16);

  return `probe:cache:${normalizedChain}:${normalizedToken}:${normalizedCapability}:${hash}`;
}
