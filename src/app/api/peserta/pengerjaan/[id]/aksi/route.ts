import { requireRole } from '@/lib/auth';
import { pool, withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { assertSebForExam } from '@/lib/seb';
import { mulaiBagian, parseTipe, selesaikanBagian, simpanJawaban, tandaiRagu, catatFokus } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Satu endpoint untuk aksi peserta di dalam pengerjaan:
 *  - mulai    : memulai bagian (PG atau ESAI)
 *  - simpan   : menyimpan satu jawaban (dipanggil saat pindah soal atau memilih nomor)
 *  - selesai  : mengakhiri bagian
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('PESERTA');
    const { id } = await params;

    const r = await pool.query(`SELECT ujian_id FROM pengerjaan WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!r.rows[0]) throw new AppError('Pengerjaan tidak ditemukan.', 404);
    await assertSebForExam(req, r.rows[0].ujian_id);

    const body = await req.json().catch(() => ({}));
    const tipe = body.aksi === 'fokus' ? 'PILIHAN_GANDA' : parseTipe(body.tipe);
    let hasil: unknown = null;

    switch (body.aksi) {
      case 'mulai':
        await withTx((c) => mulaiBagian(c, user, id, tipe));
        break;
      case 'simpan':
        if (typeof body.soalId !== 'string') throw new AppError('Soal tidak valid.', 400);
        hasil = await withTx((c) => simpanJawaban(c, user, id, body.soalId, tipe, body.nilai, body.versi));
        break;
      case 'selesai':
        await withTx((c) => selesaikanBagian(c, user, id, tipe));
        break;
      case 'ragu':
        if (typeof body.soalId !== 'string') throw new AppError('Soal tidak valid.', 400);
        await withTx((c) => tandaiRagu(c, user, id, body.soalId, tipe, body.ragu === true));
        break;
      case 'fokus':
        await withTx((c) => catatFokus(c, user, id));
        break;
      default:
        throw new AppError('Aksi tidak dikenal.', 400);
    }
    return jsonOk(hasil);
  } catch (err) {
    return jsonError(err);
  }
}
