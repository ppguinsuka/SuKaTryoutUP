import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';
import { jedaPengerjaan } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('PENGAWAS');
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.aksi !== 'jeda' && body.aksi !== 'lanjut') throw new AppError('Aksi tidak dikenal.', 400);
    await withTx((c) => jedaPengerjaan(c, user, id, body.aksi));
    return jsonOk(null);
  } catch (err) {
    return jsonError(err);
  }
}
