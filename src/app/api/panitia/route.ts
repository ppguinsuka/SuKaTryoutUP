import { createHash } from 'node:crypto';
import { requireRole } from '@/lib/auth';
import { berkasDariBase64, bacaBerkas, buatTemplate, MIME_XLSX } from '@/lib/excel';
import { imporSoal } from '@/lib/impor-soal';
import { withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { buatUlangToken, dashboardPanitia, detailSoal, detailUjian, eksporEsai, hasilUjian, imporEsai, imporPeserta, listPeserta, listSoal, listUjian, publikasi, rujukan, simpanPeserta, simpanPengawas, simpanPenugasan, simpanRuang, simpanSoal, simpanUjian, simpanSeb, ubahStatusSeb } from '@/lib/panitia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const idParam = (v: string | null, pesan: string): string => {
  if (!v || !UUID.test(v)) throw new AppError(pesan, 400);
  return v;
};

const PANITIA = ['PANITIA', 'SUPER_ADMIN'] as const;

/** Baca data: ?aksi=rujukan | peserta | soal | soal-detail | ujian | ujian-detail | hasil | ekspor-esai */
export async function GET(req: Request) {
  try {
    await requireRole(...PANITIA);
    const u = new URL(req.url);
    const aksi = u.searchParams.get('aksi');

    switch (aksi) {
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

/** Ubah data: body { aksi, data?, ujianId?, ruangId?, csv?, namaFile? } */
export async function POST(req: Request) {
  try {
    const user = await requireRole(...PANITIA);
    const body = await req.json().catch(() => ({}));
    const data = (body.data ?? {}) as Record<string, unknown>;

    switch (body.aksi) {
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
      case 'impor-peserta': {
        const buf = berkasDariBase64(body.berkas);
        const rows = bacaBerkas(buf, String(body.namaFile ?? ''));
        const n = await withTx((c) => imporPeserta(c, rows));
        return jsonOk({ jumlah: n });
      }
      case 'impor-soal': {
        const rows = bacaBerkas(berkasDariBase64(body.berkas), String(body.namaFile ?? ''));
        const n = await withTx((c) => imporSoal(c, rows));
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
      case 'simpan-penugasan': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        await withTx((c) => simpanPenugasan(c, ujianId, data));
        break;
      }
      case 'buat-ulang-token': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const ruangId = idParam(body.ruangId, 'ID ruang tidak valid.');
        await withTx((c) => buatUlangToken(c, ujianId, ruangId));
        break;
      }
      case 'impor-esai': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        const buf = berkasDariBase64(body.berkas);
        const namaFile = String(body.namaFile ?? 'impor.xlsx');
        const rows = bacaBerkas(buf, namaFile);
        const hash = createHash('sha256').update(buf).digest('hex');
        const n = await withTx((c) => imporEsai(c, ujianId, rows, namaFile, user.id, hash));
        return jsonOk({ jumlah: n });
      }
      case 'publikasi': {
        const ujianId = idParam(body.ujianId, 'ID ujian tidak valid.');
        await withTx((c) => publikasi(c, ujianId));
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

/** Unduhan berkas Excel (template impor). */
function berkasXlsx(buf: Buffer, namaFile: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME_XLSX,
      'Content-Disposition': `attachment; filename="${namaFile}"`,
      'Cache-Control': 'no-store',
    },
  });
}
