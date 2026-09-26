import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export class DatabaseClient {
  private pool: pg.Pool | null = null;
  private isConnected = false;

  constructor(private readonly connectionString?: string) {
    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    }
  }

  public async connect(): Promise<boolean> {
    if (!this.pool) {
      logger.info('DATABASE_URL not configured. Running in in-memory persistence mode.');
      return false;
    }

    try {
      const client = await this.pool.connect();
      client.release();
      this.isConnected = true;
      logger.info('PostgreSQL connected successfully.');
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`PostgreSQL connection failed (${msg}). Falling back to in-memory persistence.`);
      this.isConnected = false;
      return false;
    }
  }

  public async runMigrations(): Promise<void> {
    if (!this.pool || !this.isConnected) {
      logger.debug('Skipping migrations: database not connected.');
      return;
    }

    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const schemaPath = join(__dirname, 'schema.sql');
      const sql = await readFile(schemaPath, 'utf-8');

      await this.pool.query(sql);
      logger.info('Database migrations executed successfully.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to run database migrations', { error: msg });
      throw err;
    }
  }

  public getPool(): pg.Pool | null {
    return this.pool;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
    }
  }
}
