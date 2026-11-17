import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { pantauRuang } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireRole('PENGAWAS');
    const ujianId = new URL(req.url).searchParams.get('ujianId') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(ujianId)) throw new AppError('Ujian tidak valid.', 400);
    const data = await withTx((c) => pantauRuang(c, user, ujianId));
    return jsonOk(data);
  } catch (err) {
    return jsonError(err);
  }
}
