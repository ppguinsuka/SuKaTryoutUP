import { createSession, sha256, setSessionCookie, verifyPassword } from '@/lib/auth';
import { pool } from '@/lib/db';
import { AppError, jsonError, jsonOk } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAKS_GAGAL = 10;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password || username.length > 120 || password.length > 200) {
      throw new AppError('Username atau password tidak valid.', 400);
    }

    // Pembatasan percobaan login per kombinasi IP dan username.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = sha256(`${ip}:${username.toLowerCase()}`);
    await pool.query(`INSERT INTO login_limits (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [key]);
    await pool.query(
      `UPDATE login_limits SET failures = 0, window_start = now()
        WHERE id = $1 AND window_start < now() - interval '15 minutes'`,
      [key],
    );
    const lim = (await pool.query(`SELECT failures FROM login_limits WHERE id = $1`, [key])).rows[0];
    if (lim && lim.failures >= MAKS_GAGAL) {
      throw new AppError('Terlalu banyak percobaan login. Tunggu 15 menit.', 429);
    }

    const u = (
      await pool.query(
        `SELECT id, password_hash, status, role, nama FROM users WHERE lower(username) = lower($1)`,
        [username],
      )
    ).rows[0];
    const ok = !!u && u.status === 'ACTIVE' && (await verifyPassword(password, u.password_hash));
    if (!ok) {
      await pool.query(`UPDATE login_limits SET failures = failures + 1 WHERE id = $1`, [key]);
      throw new AppError('Username atau password salah.', 401);
    }

    await pool.query(`DELETE FROM login_limits WHERE id = $1`, [key]);
    const { token, expiresAt } = await createSession(u.id);
    await setSessionCookie(token, expiresAt);
    return jsonOk({ role: u.role, nama: u.nama });
  } catch (err) {
    return jsonError(err);
  }
}
