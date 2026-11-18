import { Pool, type PoolClient } from 'pg';
import { getPgOptions } from './pg-config.mjs';

/** Satu pool kecil per instance serverless, dengan TLS terverifikasi. */
const g = globalThis as unknown as { __sukaPool?: Pool };

/**
 * Pool dibuat ketika query pertama dijalankan, bukan saat modul dimuat.
 * Jadi error Environment Variables dapat dijelaskan oleh API login dengan aman.
 */
export function getPool(): Pool {
  if (!g.__sukaPool) {
    g.__sukaPool = new Pool({
      ...getPgOptions(),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
    g.__sukaPool.on('error', (err: Error & { code?: string }) => {
      // Jangan log seluruh pesan yang mungkin mengandung identitas DB.
      console.error('[sukatryoutup] idle-pool-error', err.code ?? err.name);
    });
  }
  return g.__sukaPool;
}

/** Proxy menjaga semua pemanggil pool.query/pool.connect lama tanpa perubahan kode. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, key: string | symbol) {
    const instance = getPool();
    const value = Reflect.get(instance, key);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

/** Transaksi rollback ketika callback gagal, release koneksi pada akhirnya. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
