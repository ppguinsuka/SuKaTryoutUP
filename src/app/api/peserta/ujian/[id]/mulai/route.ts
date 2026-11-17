import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/errors';
import { assertSebForExam } from '@/lib/seb';
import { mulaiUjian } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('PESERTA');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError(new Error('ID tidak valid'));

    await assertSebForExam(req, id);

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.slice(0, 20) : null;

    const pengerjaanId = await withTx((c) => mulaiUjian(c, user, id, token));
    return jsonOk({ pengerjaanId });
  } catch (err) {
    return jsonError(err);
  }
}
