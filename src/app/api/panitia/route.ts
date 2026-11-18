import { createHash } from 'node:crypto';
import { requireRole } from '@/lib/auth';
import { berkasDariBase64, bacaBerkas, buatTemplate, buatXlsx, MIME_XLSX } from '@/lib/excel';
import { imporSoal } from '@/lib/impor-soal';
import { withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { buatUlangToken, dashboardPanitia, detailSoal, detailUjian, eksporEsai, hasilUjian, imporEsai, imporPeserta, listPeserta, listSoal, listUjian, publikasi, rujukan, simpanPeserta, simpanPengawas, simpanPenugasan, simpanRuang, simpanSoal, simpanUjian, simpanSeb, ubahStatusSeb, imporPengawas, imporRuang, daftarRuangMonitoring, catatLog, listLog, resetPasswordPeserta, salinUjian, daftarBeritaAcara, bacaBeritaAcara, kirimBeritaAcara } from '@/lib/panitia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const idParam = (v: string | null, pesan: string): string => {
  if (!v || !UUID.test(v)) throw new AppError(pesan, 400);
  return v;
};

const PANITIA = ['PANITIA', 'SUPER_ADMIN'] as const;

/** Baca data: ?aksi=rujukan | peserta | soal | soal-detail | ujian | ujian-detail | hasil | ekspor-esai | ekspor-hasil | log | berita-daftar | berita-acara */
export async function GET(req: Request) {
  try {
    const user = await requireRole(...PANITIA);
    const u = new URL(req.url);
    const aksi = u.searchParams.get('aksi');

    switch (aksi) {
      case 'ruang-monitoring': {
        if (user.role !== 'SUPER_ADMIN') throw new AppError('Monitoring hanya untuk Super Admin.', 403);
        const ujianId = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        return jsonOk(await withTx((c) => daftarRuangMonitoring(c, ujianId)));
      }
      case 'template-pengawas':
        return berkasXlsx(buatTemplate('pengawas', []), 'template-impor-pengawas.xlsx');
      case 'template-ruang':
        return berkasXlsx(buatTemplate('ruang', []), 'template-impor-ruang.xlsx');
      case 'dashboard':
        return jsonOk(await withTx((c) => dashboardPanitia(c)));
      case 'rujukan':
        return jsonOk(await withTx((c) => rujukan(c)));
      case 'peserta':
        return jsonOk(await withTx((c) => listPeserta(c, u.searchParams.get('bidang'))));
      case 'soal':
        return jsonOk(
          await withTx((c) => listSoal(c, u.searchParams.get('bidang'), u.searchParams.get('tipe'))),
        );
      case 'soal-detail':
        return jsonOk(await withTx((c) => detailSoal(c, idParam(u.searchParams.get('id'), 'ID soal tidak valid.'))));
      case 'ujian':
        return jsonOk(await withTx((c) => listUjian(c)));
      case 'ujian-detail':
        return jsonOk(await withTx((c) => detailUjian(c, idParam(u.searchParams.get('id'), 'ID ujian tidak valid.'))));
      case 'hasil': {
        const id = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        return jsonOk(await withTx((c) => hasilUjian(c, id)));
      }
      case 'ekspor-hasil': {
        const id = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        const hasil = await withTx((c) => hasilUjian(c, id));
        const buf = buatXlsx([
          {
            nama: 'Hasil',
            baris: [
              ['Nama', 'Username', 'Status', 'PG Benar', `Total PG (${hasil.totalPilihanGanda})`, 'Skor Esai (0-100)'],
              ...hasil.rows.map((r) => [r.nama, r.username, r.status, r.skor_pilihan_ganda, hasil.totalPilihanGanda, r.skor_esai]),
            ],
          },
        ]);
        return berkasXlsx(buf, `hasil-ujian-${id.slice(0, 8)}.xlsx`);
      }
      case 'log':
        return jsonOk(await withTx((c) => listLog(c)));
      case 'berita-daftar': {
        const id = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        return jsonOk(await withTx((c) => daftarBeritaAcara(c, id)));
      }
      case 'berita-acara': {
        const ujianId = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        const ruangId = idParam(u.searchParams.get('ruangId'), 'ID ruang tidak valid.');
        return jsonOk(await withTx((c) => bacaBeritaAcara(c, ujianId, ruangId)));
      }
      case 'template-peserta': {
        const bidang = await withTx(async (c) => (await c.query('SELECT kode, nama FROM bidang_studi ORDER BY kode')).rows);
        return berkasXlsx(buatTemplate('peserta', bidang), 'template-impor-peserta.xlsx');
      }
      case 'template-esai':
        return berkasXlsx(buatTemplate('esai', []), 'template-impor-nilai-esai.xlsx');
      case 'template-soal': {
        const bidang = await withTx(async (c) => (await c.query('SELECT kode, nama FROM bidang_studi ORDER BY kode')).rows);
        return berkasXlsx(buatTemplate('soal', bidang), 'template-impor-soal.xlsx');
      }
      case 'ekspor-esai': {
        const id = idParam(u.searchParams.get('ujianId'), 'ID ujian tidak valid.');
        const csv = await withTx((c) => eksporEsai(c, id));
        return new Response('﻿' + csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="esai-${id.slice(0, 8)}.csv"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      default:
        throw new AppError('Aksi tidak dikenal.', 400);
    }
  } catch (err) {
    return jsonError(err);
  }
}

/** Ubah data: body { aksi, data?, ujianId?, ruangId?, berkas?, namaFile? } */
export async function POST(req: Request) {
  try {
    const user = await requireRole(...PANITIA);
    const body = await req.json().catch(() => ({}));
    const data = (body.data ?? {}) as Record<string, unknown>;

    switch (body.aksi) {
      case 'impor-pengawas': {
        const rows = bacaBerkas(berkasDariBase64(body.berkas), String(body.namaFile ?? ''));
        const n = await withTx(async (c) => {
          const n = await imporPengawas(c, rows);
          await catatLog(c, user.id, 'IMPOR_PENGAWAS', null, { jumlah: n, berkas: body.namaFile });
          return n;
        });
        return jsonOk({ jumlah: n });
      }
      case 'impor-ruang': {
        const rows = bacaBerkas(berkasDariBase64(body.berkas), String(body.namaFile ?? ''));
        const n = await withTx(async (c) => {
          const n = await imporRuang(c, rows);
          await catatLog(c, user.id, 'IMPOR_RUANG', null, { jumlah: n, berkas: body.namaFile });
          return n;
        });
        return jsonOk({ jumlah: n });
      }
      case 'simpan-seb': {
        const id = await withTx((c) => simpanSeb(c, data));
        return jsonOk({ id });
      }
      case 'ubah-status-seb':
        await withTx((c) => ubahStatusSeb(c, data));
        break;
      case 'simpan-ruang':
        await withTx((c) => simpanRuang(c, data));
        break;
      case 'simpan-peserta':
        await withTx((c) => simpanPeserta(c, data));
        break;
      case 'simpan-pengawas':
        await withTx((c) => simpanPengawas(c, data));
        break;
      case 'reset-password-peserta': {
        const id = idParam(typeof data.id === 'string' ? data.id : null, 'ID peserta tidak valid.');
        const hasil = await withTx(async (c) => {
          const r = await resetPasswordPeserta(c, id);
          await catatLog(c, user.id, 'RESET_PASSWORD_PESERTA', r.username);
          return r;
        });
        return jsonOk({ username: hasil.username, password: hasil.password });
      }
      case 'impor-peserta': {
        const buf = berkasDariBase64(body.berkas);
        const rows = bacaBerkas(buf, String(body.namaFile ?? ''));
        const n = await withTx(async (c) => {
          const n = await imporPeserta(c, rows);
          await catatLog(c, user.id, 'IMPOR_PESERTA', null, { jumlah: n, berkas: body.namaFile });
          return n;
        });
        return jsonOk({ jumlah: n });
      }
      case 'impor-soal': {
        const rows = bacaBerkas(berkasDariBase64(body.berkas), String(body.namaFile ?? ''));
        const n = await withTx(async (c) => {
          const n = await imporSoal(c, rows);
          await catatLog(c, user.id, 'IMPOR_SOAL', null, { jumlah: n, berkas: body.namaFile });
          return n;
        });
        return jsonOk({ jumlah: n });
      }
      case 'simpan-soal': {
        const id = await withTx((c) => simpanSoal(c, data));
        return jsonOk({ id });
      }
      case 'simpan-ujian': {
        const id = await withTx((c) => simpanUjian(c, data));
        return jsonOk({ id });
      }
      case 'salin-ujian': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const id = await withTx(async (c) => {
          const baru = await salinUjian(c, ujianId, user.id);
          await catatLog(c, user.id, 'SALIN_UJIAN', baru, { sumber: ujianId });
          return baru;
        });
        return jsonOk({ id });
      }
      case 'simpan-penugasan': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        await withTx((c) => simpanPenugasan(c, ujianId, data));
        break;
      }
      case 'buat-ulang-token': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const ruangId = idParam(body.ruangId, 'ID ruang tidak valid.');
        await withTx(async (c) => {
          await buatUlangToken(c, ujianId, ruangId);
          await catatLog(c, user.id, 'BUAT_ULANG_TOKEN', ujianId, { ruang: ruangId });
        });
        break;
      }
      case 'impor-esai': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const buf = berkasDariBase64(body.berkas);
        const namaFile = String(body.namaFile ?? 'impor.xlsx');
        const rows = bacaBerkas(buf, namaFile);
        const hash = createHash('sha256').update(buf).digest('hex');
        const n = await withTx((c) => imporEsai(c, ujianId, rows, namaFile, user.id, hash));
        await withTx((c) => catatLog(c, user.id, 'IMPOR_NILAI_ESAI', ujianId, { jumlah: n, berkas: namaFile }));
        return jsonOk({ jumlah: n });
      }
      case 'publikasi': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        await withTx(async (c) => {
          await publikasi(c, ujianId);
          await catatLog(c, user.id, 'PUBLIKASI_HASIL', ujianId);
        });
        break;
      }
      case 'kirim-berita-acara': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const ruangId = idParam(body.ruangId, 'ID ruang tidak valid.');
        await withTx(async (c) => {
          const kode = await kirimBeritaAcara(c, ujianId, ruangId, user.id);
          await catatLog(c, user.id, 'KIRIM_BERITA_ACARA', ujianId, { ruang: kode });
        });
        break;
      }
      default:
        throw new AppError('Aksi tidak dikenal.', 400);
    }
    return jsonOk(null);
  } catch (err) {
    return jsonError(err);
  }
}

/** Unduhan berkas Excel (template impor dan ekspor hasil). */
function berkasXlsx(buf: Buffer, namaFile: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME_XLSX,
      'Content-Disposition': `attachment; filename="${namaFile}"`,
      'Cache-Control': 'no-store',
    },
  });
}
