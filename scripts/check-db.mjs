/**
 * Jalankan dari root proyek: npm run db:check
 * Node.js >= 20.6: command menjalankan skrip ini dengan --env-file=.env.local.
 * Read-only: tidak menambah, mengubah, atau menghapus data.
 */
import pg from 'pg';

const TABLES = [
  'bidang_studi', 'ruang_ujian', 'seb_konfigurasi', 'users', 'sessions',
  'login_limits', 'ujian', 'ujian_bagian', 'ujian_seb', 'ujian_ruang_token',
  'penugasan_ruang', 'penugasan_pengawas', 'soal', 'soal_opsi', 'ujian_soal',
  'pengerjaan', 'pengerjaan_bagian', 'jawaban', 'impor_nilai', 'nilai_esai',
  'log_aktivitas',
];

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('GAGAL [DB_CONFIG]: DATABASE_URL tidak ditemukan di .env.local.');
  process.exit(1);
}
try {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username) {
    throw new Error('Invalid URL');
  }
  if (parsed.port !== '6543') {
    console.warn('CATATAN: pastikan menggunakan URL Transaction Pooler (umumnya port 6543).');
  }
} catch {
  console.error('GAGAL [DB_URL]: DATABASE_URL bukan URL PostgreSQL yang valid.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10000 });
try {
  const c = await pool.query('SELECT current_database() AS nama_db, current_user AS akun');
  console.log('BERHASIL: koneksi PostgreSQL aktif.');
  console.log(`Database: ${c.rows[0].nama_db}; pengguna: ${c.rows[0].akun}`);
  const result = await pool.query(
    `SELECT nama, to_regclass('public.' || nama) IS NOT NULL AS tersedia FROM unnest($1::text[]) AS t(nama)`,
    [TABLES],
  );
  const missing = result.rows.filter((r) => !r.tersedia).map((r) => r.nama);
  if (missing.length) {
    console.error(`GAGAL [DB_SCHEMA]: ${TABLES.length - missing.length}/${TABLES.length} tabel ada.`);
    console.error('Tabel belum ada:', missing.join(', '));
    process.exitCode = 2;
  } else {
    console.log(`BERHASIL: ${TABLES.length}/${TABLES.length} tabel tersedia.`);
    const a = await pool.query(`SELECT count(*)::int AS jumlah FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'`);
    if (a.rows[0].jumlah === 0) {
      console.warn('PERINGATAN: belum ada SUPER_ADMIN aktif di tabel users.');
    } else {
      console.log(`BERHASIL: ada ${a.rows[0].jumlah} akun SUPER_ADMIN aktif.`);
    }
    const priv = await pool.query(`SELECT
      has_table_privilege(current_user, 'public.login_limits', 'SELECT') AS baca_limit,
      has_table_privilege(current_user, 'public.login_limits', 'INSERT') AS tulis_limit,
      has_table_privilege(current_user, 'public.sessions', 'INSERT') AS buat_sesi`);
    if (!Object.values(priv.rows[0]).every(Boolean)) {
      console.error('GAGAL [DB_PRIVILEGE]: pengguna koneksi tidak memiliki akses login/sesi yang diperlukan.');
      process.exitCode = 3;
    } else {
      console.log('BERHASIL: hak akses dasar login dan sesi tersedia.');
    }
  }
} catch (e) {
  const kode = e.code ?? 'unknown';
  const jenis = e instanceof Error ? e.name : 'unknown';
  console.error(`GAGAL [DB_CONNECT]: kode=${kode}, jenis=${jenis}`);
  console.error('Periksa koneksi, kredensial, sertifikat SSL, dan konfigurasi host pada Supabase/Vercel.');
  // Jangan menampilkan DATABASE_URL atau kata sandi di log.
  process.exitCode = 1;
} finally {
  await pool.end();
}
