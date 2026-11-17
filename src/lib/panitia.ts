import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hashPassword } from './auth';
import { AppError } from './errors';

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

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/* ------------------------------------------------------------------ *
 * Rujukan (daftar pilihan untuk form)
 * ------------------------------------------------------------------ */
export async function rujukan(c: C) {
  return {
    bidang: (await c.query('SELECT kode, nama FROM bidang_studi ORDER BY kode')).rows,
    ruang: (await c.query('SELECT id, kode, nama, kapasitas FROM ruang_ujian ORDER BY kode')).rows,
    seb: (await c.query('SELECT id, nama, platform, aktif FROM seb_konfigurasi ORDER BY nama')).rows,
    pengawas: (
      await c.query(`SELECT id, nama, username FROM users WHERE role = 'PENGAWAS' AND status = 'ACTIVE' ORDER BY nama`)
    ).rows,
  };
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
export async function imporPeserta(c: C, csv: string): Promise<number> {
  const rows = parseCsv(csv);
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
  const isi = teks(d.isi, 'Isi soal wajib diisi.');
  const status = ['DRAFT', 'PUBLISHED', 'ARSIP'].includes(String(d.status)) ? String(d.status) : 'DRAFT';
  const kode = typeof d.kode === 'string' && d.kode.trim() ? d.kode.trim() : null;
  const rubrik = tipe === 'ESAI' ? teks(d.rubrik, 'Rubrik penilaian esai wajib diisi.') : null;
  const skorMaks = tipe === 'ESAI' ? 100 : null;

  let opsi: { label: string; teks: string; benar: boolean }[] = [];
  if (tipe === 'PILIHAN_GANDA') {
    const daftar = Array.isArray(d.opsi) ? d.opsi : [];
    opsi = daftar
      .filter((o: any) => o && typeof o.teks === 'string' && o.teks.trim())
      .map((o: any) => ({ label: String(o.label).toUpperCase(), teks: o.teks.trim(), benar: !!o.benar }));
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
        WHERE us.soal_id = $1 AND u.status IN ('AKTIF', 'SELESAI') LIMIT 1`,
      [id],
    );
    if (terpakai.rowCount) throw new AppError('Soal sudah dipakai ujian yang berjalan atau selesai, tidak dapat diubah.', 409);
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

  const soalIds: string[] = Array.isArray(d.soalIds) ? (d.soalIds as string[]) : [];
  const sebIds: string[] = Array.isArray(d.sebIds) ? (d.sebIds as string[]) : [];

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

  const jumlahPerRuang = new Map<string, number>();
  const userSudahDitugaskan = new Set<string>();
  for (const p of peserta) {
    const ruangInfo = kapRuang.get(p.ruangId);
    if (!ruangInfo) throw new AppError('Ruang tidak ditemukan.', 400);
    if (userSudahDitugaskan.has(p.userId)) throw new AppError('Satu peserta hanya boleh di satu ruang.', 400);
    userSudahDitugaskan.add(p.userId);
    const cek = await c.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'PESERTA' AND bidang_studi_kode = $2`,
      [p.userId, ujian.bidang_studi_kode],
    );
    if (!cek.rowCount) throw new AppError('Peserta tidak sesuai Bidang Studi ujian.', 400);
    const n = (jumlahPerRuang.get(p.ruangId) ?? 0) + 1;
    jumlahPerRuang.set(p.ruangId, n);
    if (n > ruangInfo.kapasitas) throw new AppError(`Kapasitas ruang ${ruangInfo.kode} terlampaui.`, 409);
  }
  for (const p of pengawas) {
    if (!kapRuang.has(p.ruangId)) throw new AppError('Ruang tidak ditemukan.', 400);
    const cek = await c.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'PENGAWAS' AND status = 'ACTIVE'`, [p.pengawasId]);
    if (!cek.rowCount) throw new AppError('Pengawas tidak valid.', 400);
  }

  await c.query('DELETE FROM penugasan_ruang WHERE ujian_id = $1', [ujianId]);
  for (const p of peserta) {
    await c.query('INSERT INTO penugasan_ruang (ujian_id, user_id, ruang_id) VALUES ($1, $2, $3)', [ujianId, p.userId, p.ruangId]);
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
  await c.query('DELETE FROM ujian_ruang_token WHERE ujian_id = $1', [ujianId]);
  if (ujian.mode_token === 'PER_RUANG') {
    for (const ruangId of jumlahPerRuang.keys()) {
      await c.query('INSERT INTO ujian_ruang_token (ujian_id, ruang_id, token) VALUES ($1, $2, $3)', [
        ujianId,
        ruangId,
        buatToken(),
      ]);
    }
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
    ...rows.map((r) => [r.pengerjaan_id, r.soal_id, 100, r.rubrik, r.nilai].map(csvCell).join(',')),
  ];
  return baris.join('\n');
}

export async function imporEsai(c: C, ujianId: string, csv: string, namaFile: string, pelakuId: string) {
  const rows = parseCsv(csv);
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
      [namaFile.slice(0, 200), createHash('sha256').update(csv).digest('hex'), pelakuId, data.length],
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
