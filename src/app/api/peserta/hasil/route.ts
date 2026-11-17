import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/errors';
import { hasilPeserta } from '@/lib/panitia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireRole('PESERTA');
    return jsonOk(await withTx((c) => hasilPeserta(c, user.id)));
  } catch (err) {
    return jsonError(err);
  }
}
