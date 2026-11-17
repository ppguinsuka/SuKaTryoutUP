import { requireRole } from '@/lib/auth';
import { pool, withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { assertSebForExam } from '@/lib/seb';
import { parseTipe, tampilanSoal } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('PESERTA');
    const { id } = await params;
    const url = new URL(req.url);
    const tipe = parseTipe(url.searchParams.get('tipe'));
    const n = Math.max(1, Math.floor(Number(url.searchParams.get('n')) || 1));

    const r = await pool.query(`SELECT ujian_id FROM pengerjaan WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!r.rows[0]) throw new AppError('Pengerjaan tidak ditemukan.', 404);
    await assertSebForExam(req, r.rows[0].ujian_id);

    const data = await withTx((c) => tampilanSoal(c, user, id, tipe, n));
    return jsonOk(data);
  } catch (err) {
    return jsonError(err);
  }
}
