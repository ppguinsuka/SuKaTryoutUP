import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hashPassword } from './auth';
import { AppError } from './errors';
import { MAKS_KONTEN, bersihkanHtml } from './sanitize';
import { teksPolos } from './konten';

type C = PoolClient;

const ALFABET_TOKEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0, O, 1, I agar mudah dibaca
const UUID = /^[0-9a-f-]{36}$/i;
const STATUS_UJIAN = ['DRAFT', 'TERJADWAL', 'AKTIF', 'SELESAI', 'ARSIP'] as const;

export function buatToken(): string {
  return Array.from(randomBytes(6), (x) => ALFABET_TOKEN[x % ALFABET_TOKEN.length]).join('');
}

function teks(v: unknown, pesan: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new AppError(pesan, 400);
  return v.trim();
}
function uuid(v: unknown, pesan: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AppError(pesan, 400);
  return v;
}
/**
 * Konten WYSIWYG (soal, opsi, rubrik): dibersihkan dengan allowlist.
 * Mengembalikan '' jika tidak ada teks maupun gambar.
 */
function bersihkanKonten(v: unknown): string {
  if (typeof v !== 'string') return '';
  if (v.length > MAKS_KONTEN) throw new AppError('Konten terlalu besar. Kecilkan ukuran gambar lalu coba lagi.', 400);
  const bersih = bersihkanHtml(v).trim();
  if (!teksPolos(bersih) && !/<img\s/i.test(bersih)) return '';
  return bersih;
}
function konten(v: unknown, pesan: string): string {
  const hasil = bersihkanKonten(v);
  if (!hasil) throw new AppError(pesan, 400);
  return hasil;
}
function tanggal(v: unknown, pesan: string): Date {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(pesan, 400);
  return d;
}

/** Parser CSV sederhana: mendukung tanda kutip ganda dan pemisah koma. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let dalamKutip = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (dalamKutip) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else dalamKutip = false;
      } else cell += ch;
    } else if (ch === '"') dalamKutip = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const csvCell = (v: unknown) => {
  const value = String(v ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+@\-]/.test(value) ? '\'' + value : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/* ------------------------------------------------------------------ *
 * Rujukan (daftar pilihan untuk form)
 * ------------------------------------------------------------------ */
export async function rujukan(c: C) {
  return {
    bidang: (await c.query('SELECT kode, nama FROM bidang_studi ORDER BY kode')).rows,
    ruang: (await c.query('SELECT id, kode, nama, kapasitas FROM ruang_ujian ORDER BY kode')).rows,
    seb: (
      await c.query(
        `SELECT s.id, s.nama, s.platform, s.aktif, COUNT(us.ujian_id)::int AS jumlah_ujian
           FROM seb_konfigurasi s LEFT JOIN ujian_seb us ON us.konfigurasi_id = s.id
          GROUP BY s.id ORDER BY s.nama`,
      )
    ).rows,
    pengawas: (
      await c.query(`SELECT id, nama, username FROM users WHERE role = 'PENGAWAS' AND status = 'ACTIVE' ORDER BY nama`)
    ).rows,
  };
}

/* ------------------------------------------------------------------ *
 * Dashboard Panitia — statistik agregat, tidak memuat jawaban peserta.
 * ------------------------------------------------------------------ */
export async function dashboardPanitia(c: C) {
  const stats = (await c.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE role = 'PESERTA' AND status = 'ACTIVE') AS peserta,
      (SELECT count(*)::int FROM users WHERE role = 'PENGAWAS' AND status = 'ACTIVE') AS pengawas,
      (SELECT count(*)::int FROM ruang_ujian) AS ruang,
      (SELECT count(*)::int FROM soal) AS soal,
      (SELECT count(*)::int FROM ujian) AS ujian,
      (SELECT count(*)::int FROM ujian WHERE status = 'AKTIF') AS ujian_aktif,
      (SELECT count(*)::int FROM pengerjaan WHERE status = 'AKTIF') AS sedang_mengerjakan,
      (SELECT count(*)::int FROM pengerjaan WHERE status = 'SELESAI') AS selesai
  `)).rows[0];
  const terbaru = (await c.query(`
    SELECT u.id, u.kode, u.judul, u.status, b.nama AS bidang,
           u.created_at,
           (SELECT count(*)::int FROM pengerjaan p WHERE p.ujian_id = u.id) AS sudah_mulai
      FROM ujian u JOIN bidang_studi b ON b.kode = u.bidang_studi_kode
     ORDER BY u.created_at DESC LIMIT 5
  `)).rows;
  return { stats, terbaru };
}

/* ------------------------------------------------------------------ *
 * Ruang ujian
 * ------------------------------------------------------------------ */
export async function simpanRuang(c: C, d: Record<string, unknown>) {
  const kode = teks(d.kode, 'Kode ruang wajib diisi.');
  const nama = teks(d.nama, 'Nama ruang wajib diisi.');
  const kap = Number(d.kapasitas);
  if (!Number.isInteger(kap) || kap < 1) throw new AppError('Kapasitas ruang tidak valid.', 400);
  if (typeof d.id === 'string' && d.id) {
    await c.query('UPDATE ruang_ujian SET kode = $2, nama = $3, kapasitas = $4 WHERE id = $1', [d.id, kode, nama, kap]);
  } else {
    await c.query('INSERT INTO ruang_ujian (kode, nama, kapasitas) VALUES ($1, $2, $3)', [kode, nama, kap]);
  }
}

/* ------------------------------------------------------------------ *
 * Peserta dan Pengawas
 * ------------------------------------------------------------------ */
export async function listPeserta(c: C, bidang: string | null) {
  return (
    await c.query(
      `SELECT id, username, nama, status, bidang_studi_kode AS bidang
         FROM users
        WHERE role = 'PESERTA' AND ($1::text IS NULL OR bidang_studi_kode = $1)
        ORDER BY nama LIMIT 1000`,
      [bidang],
    )
  ).rows;
}

/** Halaman kecil di server untuk tabel peserta besar (hingga puluhan ribu). */
export async function daftarPesertaBerhalaman(c: C, bidang: string | null, halaman: number, cari: string) {
  const page = Math.max(1, Math.min(99999, Math.trunc(halaman) || 1));
  const limit = 25;
  const term = cari.trim().slice(0,100);
  const q = `%${term.replace(/[\%_]/g, '\\$&')}%`;
  const [records, count] = await Promise.all([
    c.query(`SELECT id, username, nama, status, bidang_studi_kode AS bidang FROM users
       WHERE role='PESERTA' AND ($1::text IS NULL OR bidang_studi_kode=$1)
         AND (nama ILIKE $2 OR username ILIKE $2)
       ORDER BY nama,id LIMIT $3 OFFSET $4`, [bidang, q, limit, (page-1)*limit]),
    c.query(`SELECT count(*)::int AS total FROM users WHERE role='PESERTA'
       AND ($1::text IS NULL OR bidang_studi_kode=$1)
       AND (nama ILIKE $2 OR username ILIKE $2)`, [bidang, q]),
  ]);
  return { items: records.rows, total: Number(count.rows[0].total), page, pageSize: limit };
}

export async function simpanPeserta(c: C, d: Record<string, unknown>) {
  const username = teks(d.username, 'Username wajib diisi.');
  const nama = teks(d.nama, 'Nama wajib diisi.');
  const bidang = teks(d.bidang, 'Bidang Studi wajib dipilih.');
  if (!/^[0-9]{3}$/.test(bidang)) throw new AppError('Kode Bidang Studi tidak valid.', 400);
  const status = d.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const password = typeof d.password === 'string' ? d.password : '';

  if (typeof d.id === 'string' && d.id) {
    if (password && password.length < 8) throw new AppError('Password minimal 8 karakter.', 400);
    const hash = password ? await hashPassword(password) : null;
    await c.query(
      `UPDATE users
          SET username = $2, nama = $3, bidang_studi_kode = $4, status = $5,
              password_hash = COALESCE($6, password_hash), updated_at = now()
        WHERE id = $1 AND role = 'PESERTA'`,
      [d.id, username, nama, bidang, status, hash],
    );
    if (hash || status === 'INACTIVE') await c.query('DELETE FROM sessions WHERE user_id = $1', [d.id]);
  } else {
    if (password.length < 8) throw new AppError('Password minimal 8 karakter.', 400);
    await c.query(
      `INSERT INTO users (username, password_hash, nama, role, bidang_studi_kode, status)
       VALUES ($1, $2, $3, 'PESERTA', $4, $5)`,
      [username, await hashPassword(password), nama, bidang, status],
    );
  }
}

export async function simpanPengawas(c: C, d: Record<string, unknown>) {
  const username = teks(d.username, 'Username wajib diisi.');
  const nama = teks(d.nama, 'Nama wajib diisi.');
  const password = typeof d.password === 'string' ? d.password : '';
  if (password.length < 8) throw new AppError('Password minimal 8 karakter.', 400);
  await c.query(
    `INSERT INTO users (username, password_hash, nama, role) VALUES ($1, $2, $3, 'PENGAWAS')`,
    [username, await hashPassword(password), nama],
  );
}

/** Impor peserta dari CSV: username,nama,bidang,password. Semua baris harus valid (all-or-nothing). */
export async function imporPeserta(c: C, berkasRows: string[][]): Promise<number> {
  const rows = berkasRows.map((r) => [...r]);
  if (rows.length && rows[0][0]?.toLowerCase() === 'username') rows.shift();
  const galat: string[] = [];
  rows.forEach((r, i) => {
    const [username, nama, bidang, password] = r;
    if (!username || !nama || !/^[0-9]{3}$/.test(bidang ?? '') || (password ?? '').length < 8) {
      galat.push(`baris ${i + 1}`);
    }
  });
  if (galat.length) {
    throw new AppError(`Data tidak valid pada ${galat.slice(0, 10).join(', ')}. Periksa kode bidang (3 digit) dan password (min. 8 karakter).`, 400);
  }
  for (const [username, nama, bidang, password] of rows) {
    await simpanPeserta(c, { username, nama, bidang, password });
  }
  return rows.length;
}

/* ------------------------------------------------------------------ *
 * Soal
 * ------------------------------------------------------------------ */
export async function listSoal(c: C, bidang: string | null, tipe: string | null) {
  return (
    await c.query(
      `SELECT s.id, s.kode, s.bidang_studi_kode AS bidang, s.tipe, s.isi, s.status,
              (SELECT count(*)::int FROM soal_opsi o WHERE o.soal_id = s.id) AS jumlah_opsi
         FROM soal s
        WHERE ($1::text IS NULL OR s.bidang_studi_kode = $1)
          AND ($2::text IS NULL OR s.tipe = $2)
        ORDER BY s.created_at DESC LIMIT 500`,
      [bidang, tipe],
    )
  ).rows;
}

/** Halaman soal diambil hanya saat tab Soal dibuka. */
export async function daftarSoalBerhalaman(c: C, bidang: string | null, tipe: string | null, halaman: number, cari: string) {
  const page = Math.max(1, Math.min(99999, Math.trunc(halaman) || 1));
  const limit = 25;
  const term = cari.trim().slice(0,100);
  const q = `%${term}%`;
  const args = [bidang, tipe, q, limit, (page-1)*limit];
  const where = `($1::text IS NULL OR s.bidang_studi_kode=$1)
    AND ($2::text IS NULL OR s.tipe=$2)
    AND (coalesce(s.kode,'') ILIKE $3 OR s.isi ILIKE $3)`;
  const [records, count] = await Promise.all([
    c.query(`SELECT s.id, s.kode, s.bidang_studi_kode AS bidang, s.tipe,
      left(s.isi, 650) AS isi, s.status,
      (SELECT count(*)::int FROM soal_opsi o WHERE o.soal_id=s.id) AS jumlah_opsi
      FROM soal s WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT $4 OFFSET $5`, args),
    c.query(`SELECT count(*)::int AS total FROM soal s WHERE ${where}`, args.slice(0,3)),
  ]);
  return { items: records.rows, total: Number(count.rows[0].total), page, pageSize: limit };
}

/** Ringkasan bank soal hanya 50 soal per permintaan untuk editor ujian. */
export async function bankSoalBerhalaman(c: C, bidang: string, halaman: number, cari: string) {
  const page = Math.max(1, Math.min(99999, Math.trunc(halaman) || 1));
  const term = cari.trim().slice(0,100);
  const q = `%${term}%`;
  const limit = 50;
  const where = `status='PUBLISHED' AND bidang_studi_kode=$1 AND (coalesce(kode,'') ILIKE $2 OR isi ILIKE $2)`;
  const list = await c.query(`SELECT id,kode,tipe,left(isi,400) AS isi,status FROM soal WHERE ${where}
    ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`, [bidang,q,limit,(page-1)*limit]);
  const count = await c.query(`SELECT count(*)::int AS total FROM soal WHERE ${where}`, [bidang,q]);
  return {items:list.rows,total:Number(count.rows[0].total),page,pageSize:limit};
}

export async function detailSoal(c: C, id: string) {
  const soal = (await c.query('SELECT * FROM soal WHERE id = $1', [id])).rows[0];
  if (!soal) throw new AppError('Soal tidak ditemukan.', 404);
  const opsi = (await c.query('SELECT label, teks, benar FROM soal_opsi WHERE soal_id = $1 ORDER BY label', [id])).rows;
  return {
    id: soal.id,
    kode: soal.kode,
    bidang: soal.bidang_studi_kode,
    tipe: soal.tipe,
    isi: soal.isi,
    rubrik: soal.rubrik,
    status: soal.status,
    opsi,
  };
}

export async function simpanSoal(c: C, d: Record<string, unknown>): Promise<string> {
  const bidang = teks(d.bidang, 'Bidang Studi wajib dipilih.');
  const tipe = d.tipe;
  if (tipe !== 'PILIHAN_GANDA' && tipe !== 'ESAI') throw new AppError('Tipe soal tidak valid.', 400);
  const isi = konten(d.isi, 'Isi soal wajib diisi.');
  const status = ['DRAFT', 'PUBLISHED', 'ARSIP'].includes(String(d.status)) ? String(d.status) : 'DRAFT';
  const kode = typeof d.kode === 'string' && d.kode.trim() ? d.kode.trim() : null;
  const rubrik = tipe === 'ESAI' ? konten(d.rubrik, 'Rubrik penilaian esai wajib diisi.') : null;
  const skorMaks = tipe === 'ESAI' ? 100 : null;

  let opsi: { label: string; teks: string; benar: boolean }[] = [];
  if (tipe === 'PILIHAN_GANDA') {
    const daftar = Array.isArray(d.opsi) ? d.opsi : [];
    opsi = daftar
      .filter((o: any) => o && typeof o.teks === 'string')
      .map((o: any) => ({ label: String(o.label).toUpperCase(), teks: bersihkanKonten(o.teks), benar: !!o.benar }))
      .filter((o) => o.teks !== '');
    if (opsi.length < 2) throw new AppError('Soal pilihan ganda minimal memiliki dua opsi.', 400);
    if (!opsi.every((o) => ['A', 'B', 'C', 'D', 'E'].includes(o.label))) throw new AppError('Label opsi harus A–E.', 400);
    if (new Set(opsi.map((o) => o.label)).size !== opsi.length) throw new AppError('Label opsi tidak boleh ganda.', 400);
    if (opsi.filter((o) => o.benar).length !== 1) throw new AppError('Tepat satu opsi harus ditandai benar.', 400);
  }

  let id: string;
  if (typeof d.id === 'string' && d.id) {
    id = uuid(d.id, 'ID soal tidak valid.');
    const terpakai = await c.query(
      `SELECT 1 FROM ujian_soal us JOIN ujian u ON u.id = us.ujian_id
        WHERE us.soal_id = $1 AND (u.status IN ('AKTIF', 'SELESAI', 'DIPUBLIKASIKAN', 'ARSIP')
          OR EXISTS (SELECT 1 FROM pengerjaan p WHERE p.ujian_id = us.ujian_id)) LIMIT 1`,
      [id],
    );
    if (terpakai.rowCount) throw new AppError('Soal terkunci karena telah dipakai ujian atau peserta sudah mulai mengerjakan.', 409);
    await c.query(
      `UPDATE soal SET kode = $2, bidang_studi_kode = $3, tipe = $4, isi = $5, rubrik = $6, skor_maks = $7, status = $8
        WHERE id = $1`,
      [id, kode, bidang, tipe, isi, rubrik, skorMaks, status],
    );
    await c.query('DELETE FROM soal_opsi WHERE soal_id = $1', [id]);
  } else {
    id = (
      await c.query(
        `INSERT INTO soal (kode, bidang_studi_kode, tipe, isi, rubrik, skor_maks, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [kode, bidang, tipe, isi, rubrik, skorMaks, status],
      )
    ).rows[0].id;
  }
  for (const o of opsi) {
    await c.query('INSERT INTO soal_opsi (soal_id, label, teks, benar) VALUES ($1, $2, $3, $4)', [id, o.label, o.teks, o.benar]);
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Ujian
 * ------------------------------------------------------------------ */
export async function listUjian(c: C) {
  return (
    await c.query(
      `SELECT u.id, u.kode, u.judul, u.status, u.bidang_studi_kode AS bidang,
              (SELECT count(*)::int FROM penugasan_ruang pr WHERE pr.ujian_id = u.id) AS peserta,
              (SELECT count(*)::int FROM pengerjaan p WHERE p.ujian_id = u.id) AS sudah_mulai
         FROM ujian u ORDER BY u.created_at DESC LIMIT 200`,
    )
  ).rows;
}

async function adaPengerjaan(c: C, ujianId: string): Promise<boolean> {
  return (await c.query('SELECT 1 FROM pengerjaan WHERE ujian_id = $1 LIMIT 1', [ujianId])).rowCount! > 0;
}

export async function detailUjian(c: C, id: string) {
  const u = (
    await c.query(
      `SELECT id, kode, judul, bidang_studi_kode AS bidang, mode_token, token_sama, status, seb_wajib
         FROM ujian WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (!u) throw new AppError('Ujian tidak ditemukan.', 404);
  return {
    ...u,
    bagian: (
      await c.query(
        `SELECT tipe, durasi_menit, mulai, selesai FROM ujian_bagian WHERE ujian_id = $1 ORDER BY tipe`,
        [id],
      )
    ).rows,
    soal: (
      await c.query(
        `SELECT us.soal_id, us.urutan, s.tipe, s.isi FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
          WHERE us.ujian_id = $1 ORDER BY us.urutan`,
        [id],
      )
    ).rows,
    seb: (await c.query('SELECT konfigurasi_id FROM ujian_seb WHERE ujian_id = $1', [id])).rows.map((r) => r.konfigurasi_id),
    ruang: (
      await c.query(
        `SELECT r.id, r.kode, r.nama, r.kapasitas,
                (SELECT count(*)::int FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id) AS peserta,
                (SELECT token FROM ujian_ruang_token t WHERE t.ujian_id = $1 AND t.ruang_id = r.id) AS token,
                COALESCE((SELECT array_agg(pp.pengawas_id) FROM penugasan_pengawas pp
                           WHERE pp.ujian_id = $1 AND pp.ruang_id = r.id), '{}') AS pengawas
           FROM ruang_ujian r ORDER BY r.kode`,
        [id],
      )
    ).rows,
    pesertaBidang: (
      await c.query(
        `SELECT p.id, p.nama, p.username,
                (SELECT pr.ruang_id FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.user_id = p.id) AS ruang_id
           FROM users p
          WHERE p.role = 'PESERTA' AND p.status = 'ACTIVE' AND p.bidang_studi_kode = $2
          ORDER BY p.nama`,
        [id, u.bidang],
      )
    ).rows,
    sudahMulai: await adaPengerjaan(c, id),
  };
}

export async function simpanUjian(c: C, d: Record<string, unknown>): Promise<string> {
  const kode = teks(d.kode, 'Kode ujian wajib diisi.');
  const judul = teks(d.judul, 'Judul ujian wajib diisi.');
  const bidang = teks(d.bidang, 'Bidang Studi wajib dipilih.');
  const modeToken = d.modeToken === 'SAMA' ? 'SAMA' : 'PER_RUANG';
  const status = STATUS_UJIAN.includes(d.status as any) ? (d.status as string) : 'DRAFT';
  const sebWajib = d.sebWajib !== false;

  let tokenSama: string | null = null;
  if (modeToken === 'SAMA') {
    const t = typeof d.tokenSama === 'string' ? d.tokenSama.trim().toUpperCase() : '';
    tokenSama = t || buatToken();
    if (!/^[A-Z0-9]{6}$/.test(tokenSama)) throw new AppError('Token harus 6 karakter huruf/angka.', 400);
  }

  const bagianIn = Array.isArray(d.bagian) ? (d.bagian as any[]) : [];
  const bagian = (['PILIHAN_GANDA', 'ESAI'] as const).map((tipe) => {
    const b = bagianIn.find((x) => x?.tipe === tipe);
    if (!b) throw new AppError(`Jadwal bagian ${tipe} wajib diisi.`, 400);
    const durasi = Number(b.durasiMenit);
    if (!Number.isInteger(durasi) || durasi < 1) throw new AppError('Durasi bagian harus minimal 1 menit.', 400);
    const mulai = tanggal(b.mulai, 'Waktu mulai bagian tidak valid.');
    const selesai = tanggal(b.selesai, 'Waktu selesai bagian tidak valid.');
    if (selesai <= mulai) throw new AppError('Waktu selesai harus setelah waktu mulai.', 400);
    return { tipe, durasi, mulai, selesai };
  });

  if (bagian[0].selesai > bagian[1].mulai) throw new AppError('Jadwal esai harus dimulai setelah pilihan ganda selesai.', 400);
  const soalIds: string[] = Array.isArray(d.soalIds) ? (d.soalIds as string[]) : [];
  if (new Set(soalIds).size !== soalIds.length) throw new AppError('Soal yang sama tidak boleh dipilih dua kali.', 400);
  const sebIds: string[] = Array.isArray(d.sebIds) ? (d.sebIds as string[]) : [];
  if (sebWajib && status !== 'DRAFT' && !sebIds.length) throw new AppError('Ujian wajib SEB harus memiliki konfigurasi BEK aktif.', 400);
  if (sebWajib && status !== 'DRAFT' && sebIds.length) {
    const valid = await c.query('SELECT count(*)::int AS n FROM seb_konfigurasi WHERE aktif AND id = ANY($1::uuid[])', [sebIds]);
    if (valid.rows[0].n !== sebIds.length) throw new AppError('Ada konfigurasi SEB yang nonaktif atau tidak valid.', 400);
  }

  let id: string;
  if (typeof d.id === 'string' && d.id) {
    id = uuid(d.id, 'ID ujian tidak valid.');
    if (await adaPengerjaan(c, id)) {
      throw new AppError('Ujian sudah dikerjakan peserta. Jadwal dan soal tidak dapat diubah lagi.', 409);
    }
    await c.query(
      `UPDATE ujian SET kode = $2, judul = $3, bidang_studi_kode = $4, mode_token = $5, token_sama = $6,
                        status = $7, seb_wajib = $8
        WHERE id = $1`,
      [id, kode, judul, bidang, modeToken, tokenSama, status, sebWajib],
    );
  } else {
    id = (
      await c.query(
        `INSERT INTO ujian (kode, judul, bidang_studi_kode, mode_token, token_sama, status, seb_wajib)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [kode, judul, bidang, modeToken, tokenSama, status, sebWajib],
      )
    ).rows[0].id;
  }

  for (const b of bagian) {
    await c.query(
      `INSERT INTO ujian_bagian (ujian_id, tipe, durasi_menit, mulai, selesai) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ujian_id, tipe) DO UPDATE
         SET durasi_menit = EXCLUDED.durasi_menit, mulai = EXCLUDED.mulai, selesai = EXCLUDED.selesai`,
      [id, b.tipe, b.durasi, b.mulai, b.selesai],
    );
  }

  if (status !== 'DRAFT') {
    const pilihan = await c.query("SELECT tipe, count(*)::int AS n FROM soal WHERE id=ANY($1::uuid[]) AND bidang_studi_kode=$2 AND status='PUBLISHED' GROUP BY tipe", [soalIds, bidang]);
    const nPG = Number(pilihan.rows.find((r) => r.tipe === 'PILIHAN_GANDA')?.n ?? 0);
    const nEsai = Number(pilihan.rows.find((r) => r.tipe === 'ESAI')?.n ?? 0);
    if (nPG < 1 || nEsai < 1 || nPG + nEsai !== soalIds.length) throw new AppError('Aktivasi memerlukan minimal satu soal pilihan ganda dan satu soal esai yang diterbitkan.', 400);
  }
  // Soal: hanya soal PUBLISHED dengan Bidang Studi yang sama dengan ujian.
  await c.query('DELETE FROM ujian_soal WHERE ujian_id = $1', [id]);
  for (let i = 0; i < soalIds.length; i++) {
    const sid = uuid(soalIds[i], 'Soal tidak valid.');
    const cek = await c.query(
      `SELECT 1 FROM soal WHERE id = $1 AND status = 'PUBLISHED' AND bidang_studi_kode = $2`,
      [sid, bidang],
    );
    if (!cek.rowCount) throw new AppError('Soal harus berstatus PUBLISHED dan sesuai Bidang Studi ujian.', 400);
    await c.query('INSERT INTO ujian_soal (ujian_id, soal_id, urutan) VALUES ($1, $2, $3)', [id, sid, i + 1]);
  }

  await c.query('DELETE FROM ujian_seb WHERE ujian_id = $1', [id]);
  for (const sebId of sebIds) {
    await c.query('INSERT INTO ujian_seb (ujian_id, konfigurasi_id) VALUES ($1, $2)', [id, uuid(sebId, 'Konfigurasi SEB tidak valid.')]);
  }
  return id;
}

/**
 * Penugasan peserta ke ruang dan Pengawas ke ruang untuk satu ujian.
 * Token per ruang dibuat otomatis untuk ruang yang dipakai (mode PER_RUANG).
 */
export async function simpanPenugasan(c: C, ujianId: string, d: Record<string, unknown>) {
  const ujian = (await c.query('SELECT bidang_studi_kode, mode_token FROM ujian WHERE id = $1', [ujianId])).rows[0];
  if (!ujian) throw new AppError('Ujian tidak ditemukan.', 404);
  if (await adaPengerjaan(c, ujianId)) throw new AppError('Ujian sudah dikerjakan peserta. Penugasan tidak dapat diubah.', 409);

  const ruang = (await c.query('SELECT id, kode, kapasitas FROM ruang_ujian')).rows;
  const kapRuang = new Map<string, { kode: string; kapasitas: number }>(
    ruang.map((r) => [r.id, { kode: r.kode, kapasitas: r.kapasitas }]),
  );

  const peserta = (Array.isArray(d.peserta) ? d.peserta : []) as { userId: string; ruangId: string }[];
  const pengawas = (Array.isArray(d.pengawas) ? d.pengawas : []) as { ruangId: string; pengawasId: string }[];

  // Semua peserta divalidasi dalam satu query agar pengaturan 2.000 peserta tidak
  // menghasilkan ribuan round-trip DB.
  const jumlahPerRuang = new Map<string, number>();
  const userSudahDitugaskan = new Set<string>();
  for (const p of peserta) {
    const ruangInfo = kapRuang.get(p.ruangId);
    if (!ruangInfo) throw new AppError('Ruang tidak ditemukan.', 400);
    const idPeserta = uuid(p.userId, 'ID peserta tidak valid.');
    if (userSudahDitugaskan.has(idPeserta)) throw new AppError('Satu peserta hanya boleh di satu ruang.', 400);
    userSudahDitugaskan.add(idPeserta);
    const n = (jumlahPerRuang.get(p.ruangId) ?? 0) + 1;
    jumlahPerRuang.set(p.ruangId, n);
    if (n > ruangInfo.kapasitas) throw new AppError(`Kapasitas ruang ${ruangInfo.kode} terlampaui.`, 409);
  }
  if (userSudahDitugaskan.size) {
    const res = await c.query(
      `SELECT count(*)::int AS n FROM users
        WHERE id = ANY($1::uuid[]) AND role = 'PESERTA' AND status = 'ACTIVE'
          AND bidang_studi_kode = $2`,
      [[...userSudahDitugaskan], ujian.bidang_studi_kode]
    );
    if (Number(res.rows[0]?.n) !== userSudahDitugaskan.size)
      throw new AppError('Terdapat peserta tidak aktif atau tidak sesuai Bidang Studi ujian.', 400);
  }
  for (const p of pengawas) {
    if (!kapRuang.has(p.ruangId)) throw new AppError('Ruang tidak ditemukan.', 400);
    const cek = await c.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'PENGAWAS' AND status = 'ACTIVE'`, [p.pengawasId]);
    if (!cek.rowCount) throw new AppError('Pengawas tidak valid.', 400);
  }

  await c.query('DELETE FROM penugasan_ruang WHERE ujian_id = $1', [ujianId]);
  // INSERT batched, tidak satu INSERT per peserta. Tetap dalam satu transaksi.
  for (let i = 0; i < peserta.length; i += 300) {
    const batch = peserta.slice(i, i + 300);
    await c.query(
      `INSERT INTO penugasan_ruang (ujian_id, user_id, ruang_id)
       SELECT $1, x.uid, x.rid FROM unnest($2::uuid[], $3::uuid[]) AS x(uid, rid)`,
      [ujianId, batch.map((x) => x.userId), batch.map((x) => x.ruangId)]
    );
  }

  await c.query('DELETE FROM penugasan_pengawas WHERE ujian_id = $1', [ujianId]);
  for (const p of pengawas) {
    await c.query(
      `INSERT INTO penugasan_pengawas (ujian_id, ruang_id, pengawas_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [ujianId, p.ruangId, p.pengawasId],
    );
  }

  // Token: hanya untuk ruang yang dipakai, dan hanya jika mode PER_RUANG.
  if (ujian.mode_token === 'PER_RUANG') {
    for (const ruangId of jumlahPerRuang.keys()) {
      await c.query(
        `INSERT INTO ujian_ruang_token (ujian_id, ruang_id, token) VALUES ($1,$2,$3)
         ON CONFLICT (ujian_id, ruang_id) DO NOTHING`,
        [ujianId, ruangId, buatToken()]
      );
    }
    // Hanya buang token ruang yang tidak lagi memiliki penugasan.
    await c.query(
      `DELETE FROM ujian_ruang_token WHERE ujian_id=$1
         AND NOT (ruang_id = ANY($2::uuid[]))`, [ujianId, [...jumlahPerRuang.keys()]]
    );
  } else {
    await c.query('DELETE FROM ujian_ruang_token WHERE ujian_id=$1', [ujianId]);
  }
}

export async function buatUlangToken(c: C, ujianId: string, ruangId: string) {
  const r = await c.query(
    `UPDATE ujian_ruang_token SET token = $3 WHERE ujian_id = $1 AND ruang_id = $2`,
    [ujianId, ruangId, buatToken()],
  );
  if (!r.rowCount) throw new AppError('Ruang ini belum memiliki penugasan peserta.', 404);
}

/* ------------------------------------------------------------------ *
 * Nilai esai: ekspor ke AI, impor hasilnya
 * ------------------------------------------------------------------ */
export async function eksporEsai(c: C, ujianId: string): Promise<string> {
  const rows = (
    await c.query(
      `SELECT j.pengerjaan_id, j.soal_id, s.rubrik, j.nilai
         FROM jawaban j
         JOIN soal s ON s.id = j.soal_id
         JOIN pengerjaan p ON p.id = j.pengerjaan_id
        WHERE p.ujian_id = $1 AND j.tipe = 'ESAI'
        ORDER BY j.pengerjaan_id, j.soal_id`,
      [ujianId],
    )
  ).rows;
  // Tidak ada nama atau username: hanya ID pengerjaan dan ID soal.
  const baris = [
    ['pengerjaan_id', 'soal_id', 'skor_maks', 'rubrik', 'jawaban'].map(csvCell).join(','),
    ...rows.map((r) => [r.pengerjaan_id, r.soal_id, 100, teksPolos(r.rubrik ?? ''), r.nilai].map(csvCell).join(',')),
  ];
  return baris.join('\n');
}

export async function imporEsai(
  c: C,
  ujianId: string,
  rows: string[][],
  namaFile: string,
  pelakuId: string,
  hashBerkas: string,
) {
  if (rows.length < 2) throw new AppError('File kosong atau hanya berisi header.', 400);
  const header = rows[0].map((h) => h.toLowerCase());
  const iPeng = header.indexOf('pengerjaan_id');
  const iSoal = header.indexOf('soal_id');
  const iSkor = header.indexOf('skor');
  const iUmpan = header.indexOf('umpan_balik');
  if (iPeng < 0 || iSoal < 0 || iSkor < 0) {
    throw new AppError('Header wajib: pengerjaan_id, soal_id, skor (dan opsional umpan_balik).', 400);
  }

  const pengerjaanValid = new Set(
    (await c.query('SELECT id FROM pengerjaan WHERE ujian_id = $1', [ujianId])).rows.map((r) => r.id),
  );
  const soalEsai = new Set(
    (
      await c.query(
        `SELECT us.soal_id FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
          WHERE us.ujian_id = $1 AND s.tipe = 'ESAI'`,
        [ujianId],
      )
    ).rows.map((r) => r.soal_id),
  );

  const galat: string[] = [];
  const data = rows.slice(1).map((r, i) => {
    const skor = Number(r[iSkor]);
    const baris = i + 2;
    if (!pengerjaanValid.has(r[iPeng])) galat.push(`baris ${baris}: pengerjaan_id tidak dikenal`);
    if (!soalEsai.has(r[iSoal])) galat.push(`baris ${baris}: soal_id bukan soal esai ujian ini`);
    if (!Number.isFinite(skor) || skor < 0 || skor > 100) galat.push(`baris ${baris}: skor harus 0–100`);
    return { pengerjaanId: r[iPeng], soalId: r[iSoal], skor, umpan: iUmpan >= 0 ? r[iUmpan] ?? null : null };
  });
  if (galat.length) throw new AppError(`Impor dibatalkan. ${galat.slice(0, 10).join('; ')}`, 400);

  const impor = (
    await c.query(
      `INSERT INTO impor_nilai (nama_file, hash_file, diimpor_oleh, jumlah_baris, jumlah_galat)
       VALUES ($1, $2, $3, $4, 0) RETURNING id`,
      [namaFile.slice(0, 200), hashBerkas, pelakuId, data.length],
    )
  ).rows[0].id;

  for (const d of data) {
    await c.query(
      `INSERT INTO nilai_esai (pengerjaan_id, soal_id, skor, umpan_balik, sumber, impor_id)
       VALUES ($1, $2, $3, $4, 'AI', $5)
       ON CONFLICT (pengerjaan_id, soal_id) DO UPDATE
         SET skor = EXCLUDED.skor, umpan_balik = EXCLUDED.umpan_balik, sumber = 'AI',
             impor_id = EXCLUDED.impor_id, diperbarui_at = now()`,
      [d.pengerjaanId, d.soalId, d.skor, d.umpan, impor],
    );
  }

  await hitungUlangSkorEsai(c, ujianId);
  await c.query(
    `INSERT INTO log_aktivitas (pelaku, aksi, target, detail) VALUES ($1, 'IMPOR_NILAI_ESAI', $2, $3)`,
    [pelakuId, ujianId, JSON.stringify({ baris: data.length, file: namaFile })],
  );
  return data.length;
}

/**
 * Skor esai = rata-rata seluruh soal esai ujian (soal yang tidak dijawab dihitung 0).
 * Hanya dihitung untuk pengerjaan yang sudah selesai dan semua esai yang dijawab sudah dinilai.
 */
export async function hitungUlangSkorEsai(c: C, ujianId: string) {
  await c.query(
    `UPDATE pengerjaan p
        SET skor_esai = ROUND(
              (SELECT COALESCE(SUM(ne.skor), 0) FROM nilai_esai ne WHERE ne.pengerjaan_id = p.id)
              / NULLIF((SELECT count(*) FROM ujian_soal us JOIN soal so ON so.id = us.soal_id
                         WHERE us.ujian_id = p.ujian_id AND so.tipe = 'ESAI'), 0), 2)
      WHERE p.ujian_id = $1 AND p.status = 'SELESAI'
        AND NOT EXISTS (
          SELECT 1 FROM jawaban j
           WHERE j.pengerjaan_id = p.id AND j.tipe = 'ESAI'
             AND NOT EXISTS (SELECT 1 FROM nilai_esai ne WHERE ne.pengerjaan_id = j.pengerjaan_id AND ne.soal_id = j.soal_id))`,
    [ujianId],
  );
}

export async function publikasi(c: C, ujianId: string) {
  const u = (await c.query('SELECT status FROM ujian WHERE id = $1', [ujianId])).rows[0];
  if (!u) throw new AppError('Ujian tidak ditemukan.', 404);
  const aktif = (
    await c.query(`SELECT count(*)::int AS n FROM pengerjaan WHERE ujian_id = $1 AND status = 'AKTIF'`, [ujianId])
  ).rows[0].n;
  if (aktif > 0) throw new AppError(`Masih ada ${aktif} peserta yang sedang mengerjakan.`, 409);
  const belumDinilai = (
    await c.query(
      `SELECT count(*)::int AS n FROM pengerjaan p
        WHERE p.ujian_id = $1 AND p.status = 'SELESAI'
          AND EXISTS (SELECT 1 FROM jawaban j WHERE j.pengerjaan_id = p.id AND j.tipe = 'ESAI'
                      AND NOT EXISTS (SELECT 1 FROM nilai_esai ne WHERE ne.pengerjaan_id = j.pengerjaan_id AND ne.soal_id = j.soal_id))`,
      [ujianId],
    )
  ).rows[0].n;
  if (belumDinilai > 0) throw new AppError(`Masih ada ${belumDinilai} pengerjaan dengan esai yang belum dinilai.`, 409);
  await c.query(`UPDATE ujian SET status = 'DIPUBLIKASIKAN' WHERE id = $1`, [ujianId]);
}

export async function hasilUjian(c: C, ujianId: string) {
  const total = (
    await c.query(
      `SELECT count(*)::int AS n FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
        WHERE us.ujian_id = $1 AND s.tipe = 'PILIHAN_GANDA'`,
      [ujianId],
    )
  ).rows[0].n;
  const rows = (
    await c.query(
      `SELECT u.nama, u.username, p.status, p.skor_pilihan_ganda, p.skor_esai
         FROM pengerjaan p JOIN users u ON u.id = p.user_id
        WHERE p.ujian_id = $1 ORDER BY u.nama`,
      [ujianId],
    )
  ).rows;
  return { totalPilihanGanda: total, rows };
}

/* ------------------------------------------------------------------ *
 * Hasil untuk peserta (hanya ujian yang sudah dipublikasikan)
 * ------------------------------------------------------------------ */
export async function hasilPeserta(c: C, userId: string) {
  return (
    await c.query(
      `SELECT u.judul, u.kode, p.skor_pilihan_ganda, p.skor_esai,
              (SELECT count(*)::int FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
                WHERE us.ujian_id = u.id AND s.tipe = 'PILIHAN_GANDA') AS total_pg,
              (SELECT count(*)::int FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
                WHERE us.ujian_id = u.id AND s.tipe = 'ESAI') AS total_esai
         FROM pengerjaan p JOIN ujian u ON u.id = p.ujian_id
        WHERE p.user_id = $1 AND u.status = 'DIPUBLIKASIKAN'
        ORDER BY u.judul`,
      [userId],
    )
  ).rows;
}

/**
 * Konfigurasi SEB. BEK disimpan di server dan tidak pernah dikirim balik ke browser.
 */
export async function simpanSeb(c: C, d: Record<string, unknown>): Promise<string> {
  const nama = teks(d.nama, 'Nama konfigurasi wajib diisi.').slice(0, 100);
  const platform = String(d.platform ?? '').toUpperCase();
  if (!['WINDOWS', 'MACOS'].includes(platform)) throw new AppError('Platform harus WINDOWS atau MACOS.', 400);
  const bek = String(d.bek ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(bek)) throw new AppError('BEK harus tepat 64 karakter heksadesimal (SHA-256) dari konfigurasi SEB final.', 400);
  try {
    const r = await c.query(
      'INSERT INTO seb_konfigurasi (nama, platform, bek, aktif) VALUES ($1, $2, $3, true) RETURNING id',
      [nama, platform, bek],
    );
    return r.rows[0].id as string;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new AppError('Browser Exam Key ini sudah terdaftar.', 409);
    throw e;
  }
}

export async function ubahStatusSeb(c: C, d: Record<string, unknown>): Promise<void> {
  const id = uuid(d.id, 'Konfigurasi SEB tidak valid.');
  const r = await c.query('UPDATE seb_konfigurasi SET aktif = $2 WHERE id = $1', [id, !!d.aktif]);
  if (!r.rowCount) throw new AppError('Konfigurasi SEB tidak ditemukan.', 404);
}

/* ------------------------------------------------------------------ *
 * Impor Pengawas dan Ruang (Excel/CSV)
 * ------------------------------------------------------------------ */
type Header = Record<string, number>;
function petaHeader(rows: string[][], wajib: string[]): { header: Header; data: string[][] } {
  if (rows.length < 2) throw new AppError('File kosong atau hanya berisi header.', 400);
  const header: Header = {};
  rows[0].forEach((h, i) => { header[h.trim().toLowerCase()] = i; });
  for (const w of wajib) {
    if (!(w in header)) throw new AppError(`Header wajib: ${wajib.join(', ')}. Gunakan template yang disediakan.`, 400);
  }
  return { header, data: rows.slice(1) };
}
const sel = (r: string[], h: Header, k: string) => (h[k] !== undefined ? (r[h[k]] ?? '').trim() : '');

export async function imporPengawas(c: C, rows: string[][]): Promise<number> {
  const { header, data } = petaHeader(rows, ['username', 'nama', 'password']);
  const galat: string[] = [];
  const usernameBerkas = new Set<string>();
  const valid: { username: string; nama: string; password: string }[] = [];
  const terpakai = new Set(
    (await c.query('SELECT lower(username) AS u FROM users')).rows.map((r) => r.u as string),
  );

  data.forEach((r, i) => {
    if (r.every((v) => !v)) return;
    const baris = i + 2;
    const username = sel(r, header, 'username');
    const nama = sel(r, header, 'nama');
    const password = sel(r, header, 'password');
    const salah: string[] = [];
    if (!username || /\s/.test(username)) salah.push('username kosong atau mengandung spasi');
    else if (terpakai.has(username.toLowerCase()) || usernameBerkas.has(username.toLowerCase())) salah.push(`username "${username}" sudah dipakai`);
    if (!nama) salah.push('nama kosong');
    if (password.length < 8) salah.push('password minimal 8 karakter');
    if (salah.length) galat.push(`baris ${baris}: ${salah.join(', ')}`);
    else {
      usernameBerkas.add(username.toLowerCase());
      valid.push({ username, nama, password });
    }
  });

  if (galat.length) throw new AppError(`Impor dibatalkan. ${galat.slice(0, 10).join('; ')}`, 400);
  if (!valid.length) throw new AppError('Tidak ada pengawas yang bisa diimpor.', 400);
  for (const v of valid) {
    await c.query(
      `INSERT INTO users (username, password_hash, nama, role) VALUES ($1, $2, $3, 'PENGAWAS')`,
      [v.username, await hashPassword(v.password), v.nama],
    );
  }
  return valid.length;
}

export async function imporRuang(c: C, rows: string[][]): Promise<number> {
  const { header, data } = petaHeader(rows, ['kode', 'nama', 'kapasitas']);
  const galat: string[] = [];
  const kodeBerkas = new Set<string>();
  const valid: { kode: string; nama: string; kapasitas: number }[] = [];

  data.forEach((r, i) => {
    if (r.every((v) => !v)) return;
    const baris = i + 2;
    const kode = sel(r, header, 'kode');
    const nama = sel(r, header, 'nama');
    const kap = Number(sel(r, header, 'kapasitas'));
    const salah: string[] = [];
    if (!kode) salah.push('kode kosong');
    else if (kodeBerkas.has(kode)) salah.push(`kode "${kode}" ganda di berkas`);
    if (!nama) salah.push('nama kosong');
    if (!Number.isInteger(kap) || kap < 1) salah.push('kapasitas harus angka bulat minimal 1');
    if (salah.length) galat.push(`baris ${baris}: ${salah.join(', ')}`);
    else {
      kodeBerkas.add(kode);
      valid.push({ kode, nama, kapasitas: kap });
    }
  });

  if (galat.length) throw new AppError(`Impor dibatalkan. ${galat.slice(0, 10).join('; ')}`, 400);
  if (!valid.length) throw new AppError('Tidak ada ruang yang bisa diimpor.', 400);
  for (const v of valid) {
    await c.query(
      `INSERT INTO ruang_ujian (kode, nama, kapasitas) VALUES ($1, $2, $3)
       ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, kapasitas = EXCLUDED.kapasitas`,
      [v.kode, v.nama, v.kapasitas],
    );
  }
  return valid.length;
}

/** Ringkasan ruang untuk monitoring Super Admin: ruang yang punya penugasan pada ujian ini. */
export async function daftarRuangMonitoring(c: C, ujianId: string) {
  return (
    await c.query(
      `SELECT r.id, r.kode, r.nama, r.kapasitas,
              (SELECT count(*)::int FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id) AS peserta,
              (SELECT count(*)::int FROM penugasan_ruang pr JOIN pengerjaan p ON p.ujian_id = pr.ujian_id AND p.user_id = pr.user_id
                WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id AND p.status = 'AKTIF') AS sedang,
              (SELECT count(*)::int FROM penugasan_ruang pr JOIN pengerjaan p ON p.ujian_id = pr.ujian_id AND p.user_id = pr.user_id
                WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id AND p.status = 'SELESAI') AS selesai,
              (SELECT count(*)::int FROM penugasan_ruang pr JOIN pengerjaan p ON p.ujian_id = pr.ujian_id AND p.user_id = pr.user_id
                WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id AND p.dijeda_sejak IS NOT NULL) AS dijeda,
              (SELECT COALESCE(string_agg(u.nama, ', ' ORDER BY u.nama), '') FROM penugasan_pengawas pp
                JOIN users u ON u.id = pp.pengawas_id WHERE pp.ujian_id = $1 AND pp.ruang_id = r.id) AS pengawas
         FROM ruang_ujian r
        WHERE EXISTS (SELECT 1 FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id)
           OR EXISTS (SELECT 1 FROM penugasan_pengawas pp WHERE pp.ujian_id = $1 AND pp.ruang_id = r.id)
        ORDER BY r.kode`,
      [ujianId],
    )
  ).rows;
}

/* ------------------------------------------------------------------ *
 * Log aktivitas
 * ------------------------------------------------------------------ */
export async function catatLog(c: C, pelakuId: string, aksi: string, target: string | null, detail?: unknown) {
  await c.query(
    'INSERT INTO log_aktivitas (pelaku, aksi, target, detail) VALUES ($1, $2, $3, $4)',
    [pelakuId, aksi, target, detail === undefined ? null : JSON.stringify(detail)],
  );
}

export async function listLog(c: C) {
  return (
    await c.query(
      `SELECT l.waktu, COALESCE(u.nama, '-') AS pelaku, l.aksi, l.target, l.detail
         FROM log_aktivitas l LEFT JOIN users u ON u.id = l.pelaku
        ORDER BY l.waktu DESC LIMIT 200`,
    )
  ).rows;
}

/* ------------------------------------------------------------------ *
 * Reset password peserta: password baru dibuat server dan hanya
 * ditampilkan sekali kepada Panitia. Sesi lama peserta dihapus.
 * ------------------------------------------------------------------ */
export async function resetPasswordPeserta(c: C, id: string): Promise<{ username: string; password: string }> {
  uuid(id, 'ID peserta tidak valid.');
  const password = Array.from(randomBytes(10), (x) => ALFABET_TOKEN[x % ALFABET_TOKEN.length]).join('');
  const r = await c.query(
    `UPDATE users SET password_hash = $2, updated_at = now()
      WHERE id = $1 AND role = 'PESERTA' RETURNING username`,
    [id, await hashPassword(password)],
  );
  if (!r.rowCount) throw new AppError('Peserta tidak ditemukan.', 404);
  await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  return { username: r.rows[0].username, password };
}

/* ------------------------------------------------------------------ *
 * Salin ujian: judul, bagian dan jadwal, soal, SEB, penugasan ruang
 * dan pengawas, serta token per ruang yang baru. Hasil peserta tidak disalin.
 * ------------------------------------------------------------------ */
export async function salinUjian(c: C, ujianId: string, pelakuId: string): Promise<string> {
  uuid(ujianId, 'ID ujian tidak valid.');
  const u = (await c.query('SELECT * FROM ujian WHERE id = $1', [ujianId])).rows[0];
  if (!u) throw new AppError('Ujian tidak ditemukan.', 404);

  const baru = (
    await c.query(
      `INSERT INTO ujian (kode, judul, bidang_studi_kode, mode_token, token_sama, seb_wajib, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7) RETURNING id`,
      [
        `${u.kode}-S${buatToken().slice(0, 4)}`,
        `${u.judul} (Salinan)`,
        u.bidang_studi_kode,
        u.mode_token,
        u.mode_token === 'SAMA' ? buatToken() : null,
        u.seb_wajib,
        pelakuId,
      ],
    )
  ).rows[0].id as string;

  await c.query(
    `INSERT INTO ujian_bagian (ujian_id, tipe, durasi_menit, mulai, selesai)
     SELECT $1, tipe, durasi_menit, mulai, selesai FROM ujian_bagian WHERE ujian_id = $2`,
    [baru, ujianId],
  );
  await c.query('INSERT INTO ujian_soal (ujian_id, soal_id, urutan) SELECT $1, soal_id, urutan FROM ujian_soal WHERE ujian_id = $2', [baru, ujianId]);
  await c.query('INSERT INTO ujian_seb (ujian_id, konfigurasi_id) SELECT $1, konfigurasi_id FROM ujian_seb WHERE ujian_id = $2', [baru, ujianId]);
  await c.query('INSERT INTO penugasan_ruang (ujian_id, user_id, ruang_id) SELECT $1, user_id, ruang_id FROM penugasan_ruang WHERE ujian_id = $2', [baru, ujianId]);
  await c.query(
    'INSERT INTO penugasan_pengawas (ujian_id, ruang_id, pengawas_id) SELECT $1, ruang_id, pengawas_id FROM penugasan_pengawas WHERE ujian_id = $2',
    [baru, ujianId],
  );
  if (u.mode_token === 'PER_RUANG') {
    const ruang = (await c.query('SELECT ruang_id FROM ujian_ruang_token WHERE ujian_id = $1', [ujianId])).rows;
    for (const r of ruang) {
      await c.query('INSERT INTO ujian_ruang_token (ujian_id, ruang_id, token) VALUES ($1, $2, $3)', [baru, r.ruang_id, buatToken()]);
    }
  }
  return baru;
}

/* ------------------------------------------------------------------ *
 * Berita acara: dibuat dari data pengerjaan, dikirim setelah ujian
 * selesai, lalu disimpan sebagai salinan (snapshot) per ruang.
 * ------------------------------------------------------------------ */
/** Ujian dianggap selesai jika waktu seluruh bagian sudah lewat atau status ujian sudah SELESAI. */
async function sudahSelesai(c: C, ujianId: string): Promise<boolean> {
  const r = (
    await c.query(
      `SELECT (now() >= (SELECT max(selesai) FROM ujian_bagian WHERE ujian_id = $1)
               OR u.status IN ('SELESAI', 'DIPUBLIKASIKAN', 'ARSIP')) AS siap
         FROM ujian u WHERE u.id = $1`,
      [ujianId],
    )
  ).rows[0];
  if (!r) throw new AppError('Ujian tidak ditemukan.', 404);
  return r.siap === true;
}

async function susunBeritaAcara(c: C, ujianId: string, ruangId: string) {
  const u = (
    await c.query(
      `SELECT u.kode, u.judul, b.nama AS bidang,
              (SELECT min(mulai) FROM ujian_bagian WHERE ujian_id = u.id) AS mulai,
              (SELECT max(selesai) FROM ujian_bagian WHERE ujian_id = u.id) AS selesai
         FROM ujian u JOIN bidang_studi b ON b.kode = u.bidang_studi_kode WHERE u.id = $1`,
      [ujianId],
    )
  ).rows[0];
  const r = (await c.query('SELECT kode, nama, kapasitas FROM ruang_ujian WHERE id = $1', [ruangId])).rows[0];
  if (!u || !r) throw new AppError('Ujian atau ruang tidak ditemukan.', 404);

  const pengawas = (
    await c.query(
      `SELECT us.nama FROM penugasan_pengawas pp JOIN users us ON us.id = pp.pengawas_id
        WHERE pp.ujian_id = $1 AND pp.ruang_id = $2 ORDER BY us.nama`,
      [ujianId, ruangId],
    )
  ).rows.map((x) => x.nama as string);

  const peserta = (
    await c.query(
      `SELECT us.nama, us.username, p.status AS status_pengerjaan, p.skor_pilihan_ganda,
              p.pelanggaran_fokus, p.total_jeda_detik
         FROM penugasan_ruang pr
         JOIN users us ON us.id = pr.user_id
         LEFT JOIN pengerjaan p ON p.ujian_id = pr.ujian_id AND p.user_id = pr.user_id
        WHERE pr.ujian_id = $1 AND pr.ruang_id = $2
        ORDER BY us.nama`,
      [ujianId, ruangId],
    )
  ).rows.map((p) => ({
    nama: p.nama as string,
    username: p.username as string,
    status: (p.status_pengerjaan ?? 'TIDAK_HADIR') as string,
    skorPilihanGanda: p.skor_pilihan_ganda as number | null,
    pelanggaranFokus: Number(p.pelanggaran_fokus ?? 0),
    totalJedaDetik: Number(p.total_jeda_detik ?? 0),
  }));

  const hitung = (f: (p: (typeof peserta)[number]) => boolean) => peserta.filter(f).length;
  return {
    ujian: { kode: u.kode as string, judul: u.judul as string, bidang: u.bidang as string, mulai: u.mulai, selesai: u.selesai },
    ruang: { kode: r.kode as string, nama: r.nama as string, kapasitas: r.kapasitas as number },
    pengawas,
    peserta,
    ringkasan: {
      jumlahPeserta: peserta.length,
      hadir: hitung((p) => p.status !== 'TIDAK_HADIR'),
      tidakHadir: hitung((p) => p.status === 'TIDAK_HADIR'),
      selesai: hitung((p) => p.status === 'SELESAI'),
      masihAktif: hitung((p) => p.status === 'AKTIF'),
      totalPelanggaranFokus: peserta.reduce((n, p) => n + p.pelanggaranFokus, 0),
    },
  };
}

/** Daftar ruang beserta status berita acara untuk satu ujian. */
export async function daftarBeritaAcara(c: C, ujianId: string) {
  uuid(ujianId, 'ID ujian tidak valid.');
  const siap = await sudahSelesai(c, ujianId);
  const ruang = (
    await c.query(
      `SELECT r.id, r.kode, r.nama,
              (SELECT count(*)::int FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id) AS peserta,
              (SELECT COALESCE(string_agg(us.nama, ', ' ORDER BY us.nama), '') FROM penugasan_pengawas pp
                 JOIN users us ON us.id = pp.pengawas_id WHERE pp.ujian_id = $1 AND pp.ruang_id = r.id) AS pengawas,
              ba.dikirim_at
         FROM ruang_ujian r
         LEFT JOIN berita_acara ba ON ba.ujian_id = $1 AND ba.ruang_id = r.id
        WHERE EXISTS (SELECT 1 FROM penugasan_ruang pr WHERE pr.ujian_id = $1 AND pr.ruang_id = r.id)
        ORDER BY r.kode`,
      [ujianId],
    )
  ).rows;
  return { siap, ruang };
}

/** Isi berita acara: salinan jika sudah dikirim, pratinjau jika belum. */
export async function bacaBeritaAcara(c: C, ujianId: string, ruangId: string) {
  uuid(ujianId, 'ID ujian tidak valid.');
  uuid(ruangId, 'ID ruang tidak valid.');
  const siap = await sudahSelesai(c, ujianId);
  const kirim = (
    await c.query(
      `SELECT ba.isi, ba.dikirim_at, COALESCE(us.nama, '-') AS dikirim_oleh
         FROM berita_acara ba LEFT JOIN users us ON us.id = ba.dikirim_oleh
        WHERE ba.ujian_id = $1 AND ba.ruang_id = $2`,
      [ujianId, ruangId],
    )
  ).rows[0];
  if (kirim) {
    return { terkirim: true, siap, dikirimAt: kirim.dikirim_at, dikirimOleh: kirim.dikirim_oleh, data: kirim.isi };
  }
  return { terkirim: false, siap, dikirimAt: null, dikirimOleh: null, data: await susunBeritaAcara(c, ujianId, ruangId) };
}

export async function kirimBeritaAcara(c: C, ujianId: string, ruangId: string, pelakuId: string) {
  uuid(ujianId, 'ID ujian tidak valid.');
  uuid(ruangId, 'ID ruang tidak valid.');
  if (!(await sudahSelesai(c, ujianId))) {
    throw new AppError('Berita acara hanya dapat dikirim setelah ujian selesai.', 409);
  }
  const sudah = (await c.query('SELECT 1 FROM berita_acara WHERE ujian_id = $1 AND ruang_id = $2', [ujianId, ruangId])).rowCount;
  if (sudah) throw new AppError('Berita acara ruang ini sudah dikirim.', 409);

  const isi = await susunBeritaAcara(c, ujianId, ruangId);
  if (isi.peserta.length === 0) throw new AppError('Ruang ini belum memiliki peserta.', 400);

  await c.query(
    'INSERT INTO berita_acara (ujian_id, ruang_id, isi, dikirim_oleh) VALUES ($1, $2, $3, $4)',
    [ujianId, ruangId, JSON.stringify(isi), pelakuId],
  );
  return isi.ruang.kode;
}
