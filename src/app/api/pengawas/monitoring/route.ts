import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { pantauRuang } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireRole('PENGAWAS', 'SUPER_ADMIN');
    const ujianId = new URL(req.url).searchParams.get('ujianId') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(ujianId)) throw new AppError('Ujian tidak valid.', 400);
    const ruangId = new URL(req.url).searchParams.get('ruangId') ?? '';
    if (ruangId && !/^[0-9a-f-]{36}$/i.test(ruangId)) throw new AppError('Ruang tidak valid.', 400);
    const data = await withTx((c) => pantauRuang(c, user, ujianId, ruangId || undefined));
    return jsonOk(data);
  } catch (err) {
    return jsonError(err);
  }
}
