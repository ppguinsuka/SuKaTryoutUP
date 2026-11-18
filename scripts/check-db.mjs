/** Diagnostik DB READ ONLY. Tidak mencetak DATABASE_URL, password atau PEM. */
import { readFileSync, existsSync } from 'node:fs';
import { Pool } from 'pg';
import { getPgOptions } from '../src/lib/pg-config.mjs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
let client;
try {
  const pool = new Pool({ ...getPgOptions(), max: 1, connectionTimeoutMillis: 10000 });
  try {
    client = await pool.connect();
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const names = new Set(tables.rows.map((r) => r.table_name));
    const needed = ['users','sessions','login_limits','ujian','soal','pengerjaan','jawaban','ruang_ujian'];
    const missing = needed.filter((name) => !names.has(name));
    const tls = client.connection?.stream?.encrypted;
    console.log('Koneksi PostgreSQL: BERHASIL');
    console.log('TLS client: ' + (tls ? 'AKTIF' : 'TIDAK TERDETEKSI'));
    console.log('Tabel public: ' + tables.rowCount);
    console.log('Tabel utama: ' + (missing.length ? 'TIDAK LENGKAP (' + missing.join(', ') + ')' : 'LENGKAP'));
    if (!missing.length) {
      const users = await client.query("SELECT count(*)::int AS jumlah FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'");
      console.log('Super Admin aktif: ' + users.rows[0].jumlah);
    }
    if (missing.length) process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
} catch (e) {
  console.error('Pemeriksaan database gagal. Kode: ' + (e.code ?? e.name ?? 'UNKNOWN'));
  process.exitCode = 1;
}
