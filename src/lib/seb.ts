import { cocokHashRequestSeb } from './seb-hash.mjs';
import { pool } from './db';
import { AppError } from './errors';

/**
 * Validasi Browser Exam Key SEB klasik (HTTP RequestHash).
 * Wajib SEB dikontrol di SERVER, bukan hanya checkbox browser.
 * Hash dihitung dengan URL permintaan publik persis seperti yang SEB akses.
 * WKWebView/macOS tertentu menggunakan API JavaScript dan memerlukan integrasi
 * terpisah; jangan izinkan fallback yang dapat melewati autentikasi SEB.
 */
export async function assertSebForExam(req: Request, ujianId: string): Promise<void> {
  const settings = (await pool.query<{ seb_wajib: boolean }>(
    'SELECT seb_wajib FROM ujian WHERE id = $1', [ujianId]
  )).rows[0];
  if (!settings) throw new AppError('Ujian tidak ditemukan.', 404);
  if (!settings.seb_wajib) return;

  const { rows } = await pool.query<{ bek: string }>(
    `SELECT sk.bek FROM ujian_seb us
       JOIN seb_konfigurasi sk ON sk.id = us.konfigurasi_id
      WHERE us.ujian_id = $1 AND sk.aktif`, [ujianId]
  );
  if (!rows.length) throw new AppError('BEK belum dikonfigurasi untuk ujian ini. Hubungi Panitia.', 409);

  const raw = req.headers.get('x-safeexambrowser-requesthash')?.trim().toLowerCase();
  if (!raw) throw new AppError('Ujian ini wajib dibuka dengan SEB yang dikonfigurasi Panitia.', 403);
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new AppError('Header BEK tidak valid. Gunakan file SEB resmi.', 403);

  // Jangan gunakan Host / X-Forwarded-Host dari browser (bisa dipalsukan).
  // Next.js req.url harus merujuk ke URL publik yang sama dengan SEB.
  const incomingUrl = req.url;
  for (const { bek } of rows) {
    if (!/^[a-f0-9]{64}$/i.test(bek)) continue; // kunci lama yang tidak valid diabaikan
    if (cocokHashRequestSeb(incomingUrl, bek, raw)) return;
  }
  throw new AppError('BEK tidak cocok. Gunakan file .seb dan versi SEB yang ditentukan Panitia.', 403);
}
