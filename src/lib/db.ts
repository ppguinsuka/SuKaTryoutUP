import { Pool, type PoolClient } from 'pg';

/**
 * Supabase CA PEM harus disalin dari project yang benar ke env SUPABASE_DB_CA_CERT.
 * Validasi sertifikat TLS dan hostname TIDAK dimatikan.
 * Parameter sslmode di URL dihapus agar tidak menimpa konfigurasi ssl
 * sesuai dokumentasi node-postgres.
 */
const rawUrl = process.env.DATABASE_URL;
const caCert = process.env.SUPABASE_DB_CA_CERT?.replace(/\\n/g, '\n').trim();
let connectionString = rawUrl;
if (rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
      parsed.searchParams.delete(key);
    }
    connectionString = parsed.toString();
  } catch {
    // URL invalid tetap dibiarkan untuk diagnosis kode DB_URL.
  }
}

const verifiedSSL = {
  rejectUnauthorized: true,
  ...(caCert ? { ca: caCert } : {}),
};

// Satu pool per instance. Di Vercel, setiap fungsi punya pool sendiri, jadi max dibuat kecil
// dan koneksi wajib lewat pooler Supabase (port 6543).
const g = globalThis as unknown as { __sukaPool?: Pool };

export const pool: Pool =
  g.__sukaPool ??
  (g.__sukaPool = new Pool({
    connectionString,
    ssl: verifiedSSL,
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
