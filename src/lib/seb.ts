import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from './db';
import { AppError } from './errors';

/**
 * Verifikasi Safe Exam Browser.
 * SEB mengirim header X-SafeExamBrowser-RequestHash = SHA-256(URL lengkap + Browser Exam Key).
 * Server menghitung ulang untuk setiap BEK yang terhubung ke ujian, lalu membandingkannya.
 *
 * Catatan: URL yang dihitung harus persis sama dengan yang dilihat SEB. Di balik proxy/CDN,
 * pastikan req.url yang diterima Next.js adalah URL publik (host dan protokol).
 */
export async function assertSebForExam(req: Request, ujianId: string): Promise<void> {
  const { rows } = await pool.query<{ bek: string }>(
    `SELECT sk.bek
       FROM ujian_seb us
       JOIN seb_konfigurasi sk ON sk.id = us.konfigurasi_id
      WHERE us.ujian_id = $1 AND sk.aktif`,
    [ujianId],
  );

  if (rows.length === 0) {
    if (process.env.SEB_ALLOW_UNCONFIGURED === 'true') return;
    throw new AppError('Ujian ini belum dikaitkan dengan konfigurasi SEB. Hubungi Panitia.', 403);
  }

  const header = req.headers.get('x-safeexambrowser-requesthash');
  if (!header) {
    throw new AppError('Ujian hanya dapat dibuka melalui Safe Exam Browser (SEB) di laptop.', 403);
  }

  const received = Buffer.from(header.toLowerCase());
  for (const { bek } of rows) {
    const expected = Buffer.from(createHash('sha256').update(req.url + bek).digest('hex'));
    if (expected.length === received.length && timingSafeEqual(expected, received)) return;
  }
  throw new AppError('Konfigurasi SEB tidak sesuai. Gunakan file SEB dari Panitia.', 403);
}
