import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'db' });

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.db.url) {
      throw new Error('DATABASE_URL is not configured');
    }
    pool = new pg.Pool({
      connectionString: config.db.url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      log.error({ err }, 'Unexpected pool error');
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;
  log.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'query');
  return result;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    log.info('Database pool closed');
  }
}
