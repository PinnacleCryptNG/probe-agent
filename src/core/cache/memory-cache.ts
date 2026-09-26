import { ICache } from './cache-interface.js';
import { logger } from '../../utils/logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache implements ICache {
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly defaultTtlSeconds = 300) {}

  public async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      logger.debug('Cache miss', { key });
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      logger.debug('Cache expired', { key });
      return null;
    }

    logger.debug('Cache hit', { key });
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = (ttlSeconds ?? this.defaultTtlSeconds) * 1000;
    const expiresAt = Date.now() + ttl;
    this.store.set(key, { value, expiresAt });
  }

  public async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  public async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  public size(): number {
    return this.store.size;
  }
}
