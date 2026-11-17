import { currentUser } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return jsonOk(null);
    return jsonOk({ nama: user.nama, role: user.role, bidangStudi: user.bidangStudiKode });
  } catch (err) {
    return jsonError(err);
  }
}
