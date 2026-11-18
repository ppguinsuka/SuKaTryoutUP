import * as XLSX from 'xlsx';
import { AppError } from './errors';
import { parseCsv } from './panitia';

export type Baris = string[][];
export const MAX_IMPORT_BYTES = 2_500_000;
export const MAX_IMPORT_ROWS = 2500;
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Mengubah data base64 dari browser menjadi buffer. */
export function berkasDariBase64(v: unknown): Buffer {
  if (typeof v !== 'string' || !v) throw new AppError('Berkas impor kosong.', 400);
  if (v.length > Math.ceil(MAX_IMPORT_BYTES * 4 / 3) + 100) throw new AppError('Berkas terlalu besar. Maksimal 2,5 MB. Bagi data ke beberapa berkas.', 413);
  const data = Buffer.from(v, 'base64');
  if (!data.length || data.length > MAX_IMPORT_BYTES) throw new AppError('Ukuran berkas tidak valid. Maksimal 2,5 MB.', 413);
  return data;
}

/** Membaca berkas .xlsx (lembar pertama) atau .csv menjadi baris teks. Baris kosong dibuang. */
export function bacaBerkas(buf: Buffer, namaFile: string): Baris {
  const nama = namaFile.toLowerCase();
  let rows: Baris;
  if (buf.length > MAX_IMPORT_BYTES) throw new AppError('Berkas impor maksimal 2,5 MB.', 413);
  if (nama.endsWith('.xlsx') || nama.endsWith('.xls')) {
    const xlsxSignature = buf[0] === 0x50 && buf[1] === 0x4b;
    const xlsSignature = buf[0] === 0xd0 && buf[1] === 0xcf;
    if (!((nama.endsWith('.xlsx') && xlsxSignature) || (nama.endsWith('.xls') && xlsSignature))) {
      throw new AppError('Format file dan isinya tidak cocok. Gunakan template asli.', 400);
    }
    const wb = XLSX.read(buf, { type: 'buffer', sheetRows: MAX_IMPORT_ROWS + 2, cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, bookVBA: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new AppError('File Excel tidak berisi lembar kerja.', 400);
    rows = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false })
      .map((r) => (r as unknown[]).map((v) => String(v ?? '').trim()));
  } else if (nama.endsWith('.csv')) {
    rows = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  } else {
    throw new AppError('Format berkas harus .xlsx atau .csv. Gunakan template yang disediakan.', 400);
  }
  rows = rows.filter((r) => r.some((c) => c !== ''));
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new AppError(`Maksimal ${MAX_IMPORT_ROWS} baris per berkas. Bagi file menjadi beberapa bagian.`, 413);
  if (rows.some((r) => r.length > 35 || r.some((c) => String(c).length > 50000))) {
    throw new AppError('Berkas memiliki terlalu banyak kolom atau sel terlalu panjang.', 400);
  }
  return rows;
}

/** Membuat berkas template Excel untuk impor. */
export function buatTemplate(
  jenis: 'peserta' | 'esai' | 'soal' | 'pengawas' | 'ruang',
  bidang: { kode: string; nama: string }[],
): Buffer {
  const wb = XLSX.utils.book_new();

  if (jenis === 'pengawas' || jenis === 'ruang') {
    const header = jenis === 'pengawas' ? ['username', 'nama', 'password'] : ['kode', 'nama', 'kapasitas'];
    const contoh = jenis === 'pengawas'
      ? ['pengawas01', 'Contoh Pengawas', 'contohpassword']
      : ['R-01', 'Ruang 1 Gedung Utama', '30'];
    const ws = XLSX.utils.aoa_to_sheet([header, contoh]);
    ws['!cols'] = header.map(() => ({ wch: 26 }));
    XLSX.utils.book_append_sheet(wb, ws, jenis === 'pengawas' ? 'Pengawas' : 'Ruang');
    const petunjuk = jenis === 'pengawas'
      ? [
          ['Petunjuk impor pengawas'],
          [''],
          ['username: unik, tanpa spasi. Pengawas login memakai username ini.'],
          ['nama: nama lengkap.'],
          ['password: minimal 8 karakter.'],
          ['Pengawas tidak terikat bidang studi. Penugasan ruang dilakukan di panel Panitia.'],
          ['Hapus baris contoh sebelum mengimpor. Satu baris salah membatalkan seluruh impor.'],
        ]
      : [
          ['Petunjuk impor ruang'],
          [''],
          ['kode: unik per ruang, misalnya R-01.'],
          ['nama: nama ruang atau lokasi.'],
          ['kapasitas: angka bulat minimal 1.'],
          ['Jika kode sudah ada, nama dan kapasitasnya diperbarui.'],
          ['Hapus baris contoh sebelum mengimpor. Satu baris salah membatalkan seluruh impor.'],
        ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(petunjuk), 'Petunjuk');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  if (jenis === 'soal') {
    const header = ['kode', 'bidang', 'tipe', 'isi', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'kunci', 'rubrik', 'status'];
    const ws = XLSX.utils.aoa_to_sheet([
      header,
      ['SOAL-001', '237', 'PILIHAN_GANDA', 'Contoh pertanyaan pilihan ganda?', 'Jawaban A', 'Jawaban B', 'Jawaban C', 'Jawaban D', '', 'B', '', 'PUBLISHED'],
      ['SOAL-002', '237', 'ESAI', 'Contoh pertanyaan esai?', '', '', '', '', '', '', 'Kriteria penilaian dan skor 0–100 (hapus baris contoh ini).', 'PUBLISHED'],
    ]);
    ws['!cols'] = header.map((h) => ({ wch: h === 'isi' || h === 'rubrik' ? 44 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Soal');

    const kode = XLSX.utils.aoa_to_sheet([['kode', 'nama'], ...bidang.map((b) => [b.kode, b.nama])]);
    kode['!cols'] = [{ wch: 10 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, kode, 'Kode Bidang');

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Petunjuk impor soal'],
        [''],
        ['tipe: PILIHAN_GANDA atau ESAI.'],
        ['bidang: kode 3 digit sesuai sheet Kode Bidang. Soal mengikuti bidang studi.'],
        ['isi: teks soal. Gambar tidak dapat dimasukkan lewat Excel; tambahkan setelah impor lewat editor.'],
        ['opsi_a sampai opsi_e: hanya untuk PILIHAN_GANDA. Minimal opsi_a dan opsi_b.'],
        ['kunci: huruf jawaban benar (A–E) untuk PILIHAN_GANDA.'],
        ['rubrik: wajib untuk ESAI. Dipakai AI untuk memberi nilai 0–100.'],
        ['status: DRAFT atau PUBLISHED (kosong = PUBLISHED). Kode soal harus unik.'],
        ['Hapus baris contoh sebelum mengimpor. Satu baris salah membatalkan seluruh impor.'],
      ]),
      'Petunjuk',
    );
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  if (jenis === 'peserta') {
    const ws = XLSX.utils.aoa_to_sheet([
      ['username', 'nama', 'bidang', 'password'],
      ['230001', 'Contoh Peserta', '237', 'contohpassword'],
    ]);
    ws['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 10 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Peserta');

    const kode = XLSX.utils.aoa_to_sheet([['kode', 'nama'], ...bidang.map((b) => [b.kode, b.nama])]);
    kode['!cols'] = [{ wch: 10 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, kode, 'Kode Bidang');

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Petunjuk impor peserta'],
        [''],
        ['Kolom: username, nama, bidang, password.'],
        ['username: unik dan tanpa spasi. Peserta login memakai username ini.'],
        ['bidang: kode 3 digit sesuai sheet Kode Bidang, misalnya 237.'],
        ['password: minimal 8 karakter.'],
        ['Isi kolom username dan bidang sebagai teks agar angka 0 di depan tidak hilang.'],
        ['Hapus baris contoh sebelum mengimpor. Satu baris salah membatalkan seluruh impor.'],
      ]),
      'Petunjuk',
    );
  } else {
    const ws = XLSX.utils.aoa_to_sheet([
      ['pengerjaan_id', 'soal_id', 'skor', 'umpan_balik'],
      ['(salin dari ekspor esai)', '(salin dari ekspor esai)', 85, 'Contoh umpan balik (opsional)'],
    ]);
    ws['!cols'] = [{ wch: 40 }, { wch: 40 }, { wch: 8 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Nilai Esai');

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Petunjuk impor nilai esai'],
        [''],
        ['Ambil pengerjaan_id dan soal_id dari berkas ekspor esai (menu Nilai Esai → Unduh esai).'],
        ['skor: angka 0 sampai 100.'],
        ['umpan_balik: opsional.'],
        ['Hapus baris contoh sebelum mengimpor. Satu baris salah membatalkan seluruh impor.'],
      ]),
      'Petunjuk',
    );
  }

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/** Membuat berkas .xlsx dari beberapa lembar (untuk ekspor hasil dan lain-lain). */
export function buatXlsx(lembar: { nama: string; baris: (string | number | null)[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const l of lembar) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(l.baris), l.nama.slice(0, 31));
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
