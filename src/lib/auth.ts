import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { pool } from './db';
import { AppError } from './errors';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const ROLES = ['SUPER_ADMIN', 'PANITIA', 'PENGAWAS', 'PESERTA'] as const;
export type Role = (typeof ROLES)[number];

export type SessionUser = {
  id: string;
  username: string;
  nama: string;
  role: Role;
  bidangStudiKode: string | null;
};

const COOKIE = 'suka_sid';
const SESSION_HOURS = 12;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltHex, keyHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Membuat sesi baru. Token hanya disimpan dalam bentuk hash di database. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  store.delete(COOKIE);
}

/** Mengambil pengguna dari cookie. Mengembalikan null jika tidak login atau akun nonaktif. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.nama, u.role, u.bidang_studi_kode
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'ACTIVE'`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    nama: r.nama,
    role: r.role,
    bidangStudiKode: r.bidang_studi_kode,
  };
}

/** Dipakai di route handler. Melempar 401/403 jika tidak sesuai role. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AppError('Silakan login terlebih dahulu.', 401);
  if (!roles.includes(user.role)) throw new AppError('Anda tidak memiliki akses ke halaman ini.', 403);
  return user;
}
