import type { PoolClient } from 'pg';
import { AppError } from './errors';
import { kontenKeHtml } from './konten';
import { simpanSoal } from './panitia';

type C = PoolClient;
const LABEL = ['A', 'B', 'C', 'D', 'E'] as const;

function normTipe(v: string): 'PILIHAN_GANDA' | 'ESAI' | null {
  const t = v.trim().toUpperCase().replace(/\s+/g, '_');
  if (t === 'PILIHAN_GANDA' || t === 'PG') return 'PILIHAN_GANDA';
  if (t === 'ESAI') return 'ESAI';
  return null;
}

/**
 * Impor soal dari Excel/CSV (template: kode, bidang, tipe, isi, opsi_a..opsi_e, kunci, rubrik, status).
 * Semua baris divalidasi lebih dulu. Jika ada yang salah, tidak ada soal yang tersimpan.
 */
export async function imporSoal(c: C, rows: string[][]): Promise<number> {
  if (rows.length < 2) throw new AppError('File kosong atau hanya berisi header.', 400);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const wajib of ['bidang', 'tipe', 'isi']) {
    if (!header.includes(wajib)) throw new AppError(`Header wajib: ${wajib}. Gunakan template yang disediakan.`, 400);
  }
  const kolom = (r: string[], nama: string) => {
    const k = header.indexOf(nama);
    return k >= 0 ? (r[k] ?? '').trim() : '';
  };

  const bidangValid = new Set((await c.query('SELECT kode FROM bidang_studi')).rows.map((r) => r.kode as string));
  const kodeTerpakai = new Set(
    (await c.query('SELECT kode FROM soal WHERE kode IS NOT NULL')).rows.map((r) => r.kode as string),
  );

  const galat: string[] = [];
  const data: Parameters<typeof simpanSoal>[1][] = [];
  const kodeDiBerkas = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const baris = i + 1;
    if (r.every((v) => !v)) continue;
    const salah = (pesan: string) => galat.push(`baris ${baris}: ${pesan}`);

    const bidang = kolom(r, 'bidang');
    if (!bidangValid.has(bidang)) salah(`kode bidang "${bidang}" tidak dikenal`);

    const tipe = normTipe(kolom(r, 'tipe'));
    if (!tipe) salah('tipe harus PILIHAN_GANDA atau ESAI');

    const isi = kolom(r, 'isi');
    if (!isi) salah('isi soal kosong');

    const status = kolom(r, 'status').toUpperCase() || 'PUBLISHED';
    if (!['DRAFT', 'PUBLISHED'].includes(status)) salah('status harus DRAFT atau PUBLISHED');

    const kode = kolom(r, 'kode') || null;
    if (kode) {
      if (kodeTerpakai.has(kode) || kodeDiBerkas.has(kode)) salah(`kode "${kode}" sudah dipakai`);
      kodeDiBerkas.add(kode);
    }

    if (tipe === 'PILIHAN_GANDA') {
      const opsi = LABEL.map((l) => ({ label: l, teks: kolom(r, `opsi_${l.toLowerCase()}`) })).filter((o) => o.teks);
      const kunci = kolom(r, 'kunci').toUpperCase();
      if (opsi.length < 2) salah('soal pilihan ganda minimal dua opsi (opsi_a dan opsi_b)');
      if (!LABEL.includes(kunci as (typeof LABEL)[number])) salah('kunci harus A–E');
      else if (!opsi.some((o) => o.label === kunci)) salah(`kunci ${kunci} tidak punya teks opsi`);
      if (!galat.some((g) => g.startsWith(`baris ${baris}:`))) {
        data.push({
          kode,
          bidang,
          tipe,
          isi: kontenKeHtml(isi),
          status,
          opsi: opsi.map((o) => ({ label: o.label, teks: kontenKeHtml(o.teks), benar: o.label === kunci })),
        });
      }
    } else if (tipe === 'ESAI') {
      const rubrik = kolom(r, 'rubrik');
      if (!rubrik) salah('rubrik penilaian wajib untuk soal esai');
      if (!galat.some((g) => g.startsWith(`baris ${baris}:`))) {
        data.push({ kode, bidang, tipe, isi: kontenKeHtml(isi), rubrik: kontenKeHtml(rubrik), status });
      }
    }
  }

  if (galat.length) {
    throw new AppError(`Impor dibatalkan. ${galat.slice(0, 10).join('; ')}`, 400);
  }
  if (!data.length) throw new AppError('Tidak ada soal yang bisa diimpor.', 400);

  for (let i = 0; i < data.length; i++) {
    await simpanSoal(c, data[i]);
  }
  return data.length;
}
