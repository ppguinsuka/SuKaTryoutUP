import { requireRole } from '@/lib/auth';
import { pool } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Daftar ujian yang diawasi Pengawas ini (lintas Bidang Studi). */
export async function GET() {
  try {
    const user = await requireRole('PENGAWAS');
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.kode, u.judul, u.status, bs.nama AS bidang_studi
         FROM penugasan_pengawas pp
         JOIN ujian u ON u.id = pp.ujian_id
         JOIN bidang_studi bs ON bs.kode = u.bidang_studi_kode
        WHERE pp.pengawas_id = $1
        ORDER BY u.judul`,
      [user.id],
    );
    return jsonOk(rows);
  } catch (err) {
    return jsonError(err);
  }
}
