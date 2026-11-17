import { Pool, type PoolClient } from 'pg';

// Satu pool per instance. Di Vercel, setiap fungsi punya pool sendiri, jadi max dibuat kecil
// dan koneksi wajib lewat pooler Supabase (port 6543).
const g = globalThis as unknown as { __sukaPool?: Pool };

// Koneksi SSL memakai sertifikat CA Supabase (DATABASE_CA_CERT), bukan sslmode di URL.
// Parameter sslmode dihapus dari URL supaya pengaturan di sini yang berlaku.
const caPem = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
const connectionString = process.env.DATABASE_URL?.replace(/([?&])sslmode=[^&]*(&|$)/, (_m, p1, p2) =>
  p2 ? p1 : '',
).replace(/[?&]$/, '');

export const pool: Pool =
  g.__sukaPool ??
  (g.__sukaPool = new Pool({
    connectionString,
    ssl: caPem ? { ca: caPem, rejectUnauthorized: true } : undefined,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  }));

/** Menjalankan fungsi dalam satu transaksi. Rollback otomatis jika melempar error. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
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
