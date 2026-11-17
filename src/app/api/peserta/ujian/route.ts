import { requireRole } from '@/lib/auth';
import { withTx } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/errors';
import { daftarUjianPeserta } from '@/lib/ujian';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireRole('PESERTA');
    const data = await withTx((c) => daftarUjianPeserta(c, user));
    return jsonOk(data);
  } catch (err) {
    return jsonError(err);
  }
}
