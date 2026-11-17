import { clearSession } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await clearSession();
    return jsonOk(null);
  } catch (err) {
    return jsonError(err);
  }
}
