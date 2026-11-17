import type { PoolClient } from 'pg';
import type { SessionUser } from './auth';
import { AppError } from './errors';

export type Tipe = 'PILIHAN_GANDA' | 'ESAI';

export function parseTipe(v: unknown): Tipe {
  if (v === 'PILIHAN_GANDA' || v === 'ESAI') return v;
  throw new AppError('Bagian ujian tidak valid.', 400);
}

const LABELS = ['A', 'B', 'C', 'D', 'E'];
const MAKS_ESAI = 10_000;

/* ------------------------------------------------------------------ *
 * Pengerjaan: mulai dengan token (sekali per peserta per ujian)
 * ------------------------------------------------------------------ */
export async function mulaiUjian(
  c: PoolClient,
  user: SessionUser,
  ujianId: string,
  token: string | null,
): Promise<string> {
  const ujian = (
    await c.query(
      `SELECT id, status, bidang_studi_kode, mode_token, token_sama FROM ujian WHERE id = $1`,
      [ujianId],
    )
  ).rows[0];
  if (!ujian || ujian.bidang_studi_kode !== user.bidangStudiKode) {
    throw new AppError('Ujian tidak tersedia untuk Anda.', 404);
  }
  if (!['TERJADWAL', 'AKTIF'].includes(ujian.status)) {
    throw new AppError('Ujian belum dibuka atau sudah ditutup.', 409);
  }

  const pr = (
    await c.query(`SELECT ruang_id FROM penugasan_ruang WHERE ujian_id = $1 AND user_id = $2`, [
      ujianId,
      user.id,
    ])
  ).rows[0];
  if (!pr) throw new AppError('Anda belum ditempatkan di ruang ujian ini.', 403);

  const existing = (
    await c.query(`SELECT id FROM pengerjaan WHERE ujian_id = $1 AND user_id = $2`, [ujianId, user.id])
  ).rows[0];
  if (existing) return existing.id as string;

  // Pengerjaan baru wajib token.
  const expected: string | null =
    ujian.mode_token === 'SAMA'
      ? ujian.token_sama
      : ((
          await c.query(`SELECT token FROM ujian_ruang_token WHERE ujian_id = $1 AND ruang_id = $2`, [
            ujianId,
            pr.ruang_id,
          ])
        ).rows[0]?.token ?? null);
  if (!expected) throw new AppError('Token ujian belum tersedia. Hubungi Pengawas.', 409);
  if (!token || token.trim().toUpperCase() !== expected.toUpperCase()) {
    throw new AppError('Token tidak sesuai.', 403);
  }

  const active = (
    await c.query(`SELECT 1 FROM pengerjaan WHERE user_id = $1 AND status = 'AKTIF' LIMIT 1`, [user.id])
  ).rows[0];
  if (active) throw new AppError('Anda masih memiliki pengerjaan yang sedang berjalan.', 409);

  try {
    const ins = await c.query(
      `INSERT INTO pengerjaan (ujian_id, user_id, ruang_id) VALUES ($1, $2, $3) RETURNING id`,
      [ujianId, user.id, pr.ruang_id],
    );
    const id = ins.rows[0].id as string;
    await c.query(
      `INSERT INTO pengerjaan_bagian (pengerjaan_id, tipe)
       VALUES ($1, 'PILIHAN_GANDA'), ($1, 'ESAI')`,
      [id],
    );
    return id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('Pengerjaan untuk ujian ini sudah ada.', 409);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Sinkronisasi waktu: menutup bagian yang habis waktunya dan
 * menghitung skor pilihan ganda. Dipanggil setiap aksi (di dalam tx).
 * ------------------------------------------------------------------ */
export async function sinkronkanPengerjaan(c: PoolClient, pengerjaanId: string) {
  const p = (
    await c.query(`SELECT id, ujian_id, user_id, status FROM pengerjaan WHERE id = $1 FOR UPDATE`, [
      pengerjaanId,
    ])
  ).rows[0];
  if (!p) throw new AppError('Pengerjaan tidak ditemukan.', 404);
  if (p.status !== 'AKTIF') return p;

  // Bagian yang sedang berjalan dan melewati batas (tidak sedang dijeda) ditutup.
  await c.query(
    `UPDATE pengerjaan_bagian pb
        SET status = 'SELESAI', selesai = LEAST(pb.batas, ub.selesai)
       FROM pengerjaan p, ujian_bagian ub
      WHERE pb.pengerjaan_id = $1 AND pb.status = 'SEDANG'
        AND p.id = pb.pengerjaan_id
        AND ub.ujian_id = p.ujian_id AND ub.tipe = pb.tipe
        AND LEAST(pb.batas, ub.selesai) < now()`,
    [pengerjaanId],
  );

  // Bagian yang belum dimulai, tetapi jadwalnya sudah lewat, ikut ditutup.
  await c.query(
    `UPDATE pengerjaan_bagian pb
        SET status = 'SELESAI', selesai = now()
       FROM pengerjaan p, ujian_bagian ub
      WHERE pb.pengerjaan_id = $1 AND pb.status = 'BELUM_DIMULAI'
        AND p.id = pb.pengerjaan_id
        AND ub.ujian_id = p.ujian_id AND ub.tipe = pb.tipe
        AND ub.selesai < now()`,
    [pengerjaanId],
  );

  await hitungSkorPilihanGanda(c, pengerjaanId);

  await c.query(
    `UPDATE pengerjaan p SET status = 'SELESAI'
      WHERE p.id = $1 AND p.status = 'AKTIF'
        AND NOT EXISTS (
          SELECT 1 FROM pengerjaan_bagian pb
           WHERE pb.pengerjaan_id = p.id AND pb.status <> 'SELESAI')`,
    [pengerjaanId],
  );

  return (await c.query(`SELECT id, ujian_id, user_id, status FROM pengerjaan WHERE id = $1`, [pengerjaanId]))
    .rows[0];
}

async function hitungSkorPilihanGanda(c: PoolClient, pengerjaanId: string) {
  await c.query(
    `UPDATE pengerjaan p
        SET skor_pilihan_ganda = (
          SELECT count(*)::int FROM jawaban j
            JOIN soal_opsi o ON o.soal_id = j.soal_id AND o.label = j.nilai AND o.benar
           WHERE j.pengerjaan_id = p.id AND j.tipe = 'PILIHAN_GANDA')
      WHERE p.id = $1 AND p.skor_pilihan_ganda IS NULL
        AND EXISTS (
          SELECT 1 FROM pengerjaan_bagian pb
           WHERE pb.pengerjaan_id = p.id AND pb.tipe = 'PILIHAN_GANDA' AND pb.status = 'SELESAI')`,
    [pengerjaanId],
  );
}

async function assertMilikPeserta(c: PoolClient, pengerjaanId: string, userId: string) {
  const p = await sinkronkanPengerjaan(c, pengerjaanId);
  if (p.user_id !== userId) throw new AppError('Pengerjaan tidak ditemukan.', 404);
  return p as { id: string; ujian_id: string; status: string };
}

/* ------------------------------------------------------------------ *
 * Aksi peserta per bagian
 * ------------------------------------------------------------------ */
export async function mulaiBagian(c: PoolClient, user: SessionUser, pengerjaanId: string, tipe: Tipe) {
  const p = await assertMilikPeserta(c, pengerjaanId, user.id);
  if (p.status !== 'AKTIF') throw new AppError('Pengerjaan sudah selesai.', 409);

  if (tipe === 'ESAI') {
    const pg = (
      await c.query(
        `SELECT status FROM pengerjaan_bagian WHERE pengerjaan_id = $1 AND tipe = 'PILIHAN_GANDA'`,
        [pengerjaanId],
      )
    ).rows[0];
    if (pg?.status !== 'SELESAI') {
      throw new AppError('Bagian esai dapat dikerjakan setelah pilihan ganda selesai.', 409);
    }
  }

  const row = (
    await c.query(
      `SELECT pb.status, pb.batas, p.dijeda_sejak, ub.durasi_menit, ub.mulai, ub.selesai
         FROM pengerjaan_bagian pb
         JOIN pengerjaan p ON p.id = pb.pengerjaan_id
         JOIN ujian_bagian ub ON ub.ujian_id = p.ujian_id AND ub.tipe = pb.tipe
        WHERE pb.pengerjaan_id = $1 AND pb.tipe = $2
        FOR UPDATE OF pb`,
      [pengerjaanId, tipe],
    )
  ).rows[0];
  if (!row) throw new AppError('Bagian ujian tidak ditemukan.', 404);
  if (row.status === 'SELESAI') throw new AppError('Bagian ini sudah selesai.', 409);
  if (row.dijeda_sejak) throw new AppError('Pengerjaan sedang dijeda oleh Pengawas.', 409);

  if (row.status === 'BELUM_DIMULAI') {
    const ok = (await c.query(`SELECT now() BETWEEN $1::timestamptz AND $2::timestamptz AS ok`, [
      row.mulai,
      row.selesai,
    ])).rows[0].ok;
    if (!ok) throw new AppError('Di luar jadwal bagian ini.', 409);
    await c.query(
      `UPDATE pengerjaan_bagian
          SET status = 'SEDANG_DIKERJAKAN', mulai = now(),
              batas = LEAST(now() + make_interval(mins => $3), $4::timestamptz)
        WHERE pengerjaan_id = $1 AND tipe = $2`,
      [pengerjaanId, tipe, row.durasi_menit, row.selesai],
    );
  }
}

export async function simpanJawaban(
  c: PoolClient,
  user: SessionUser,
  pengerjaanId: string,
  soalId: string,
  tipe: Tipe,
  nilaiMentah: unknown,
) {
  const p = await assertMilikPeserta(c, pengerjaanId, user.id);
  if (p.status !== 'AKTIF') throw new AppError('Pengerjaan sudah selesai.', 409);

  const bagian = (
    await c.query(
      `SELECT status FROM pengerjaan_bagian WHERE pengerjaan_id = $1 AND tipe = $2 FOR UPDATE`,
      [pengerjaanId, tipe],
    )
  ).rows[0];
  if (bagian?.status !== 'SEDANG_DIKERJAKAN') {
    throw new AppError('Waktu bagian ini sudah habis atau belum dimulai.', 409);
  }
  const jeda = (await c.query(`SELECT dijeda_sejak FROM pengerjaan WHERE id = $1`, [pengerjaanId])).rows[0];
  if (jeda.dijeda_sejak) throw new AppError('Pengerjaan sedang dijeda oleh Pengawas.', 409);

  const soal = (
    await c.query(
      `SELECT s.id, s.tipe FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
        WHERE us.ujian_id = $1 AND s.id = $2`,
      [p.ujian_id, soalId],
    )
  ).rows[0];
  if (!soal || soal.tipe !== tipe) throw new AppError('Soal tidak termasuk dalam ujian ini.', 400);

  const nilai = typeof nilaiMentah === 'string' ? nilaiMentah : '';

  if (tipe === 'PILIHAN_GANDA') {
    if (nilai !== '' && !LABELS.includes(nilai)) throw new AppError('Pilihan jawaban tidak valid.', 400);
  } else if (nilai.length > MAKS_ESAI) {
    throw new AppError(`Jawaban esai maksimal ${MAKS_ESAI} karakter.`, 400);
  }

  if (nilai === '') {
    await c.query(`DELETE FROM jawaban WHERE pengerjaan_id = $1 AND soal_id = $2`, [pengerjaanId, soalId]);
  } else {
    await c.query(
      `INSERT INTO jawaban (pengerjaan_id, soal_id, tipe, nilai, disimpan_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (pengerjaan_id, soal_id)
       DO UPDATE SET nilai = EXCLUDED.nilai, disimpan_at = now()`,
      [pengerjaanId, soalId, tipe, nilai],
    );
  }

  // Hitungan untuk dashboard monitoring: diperbarui di tempat, tanpa membaca ulang seluruh jawaban.
  await c.query(
    `UPDATE pengerjaan_bagian
        SET jumlah_tersimpan = (SELECT count(*)::int FROM jawaban WHERE pengerjaan_id = $1 AND tipe = $2),
            revisi = revisi + 1
      WHERE pengerjaan_id = $1 AND tipe = $2`,
    [pengerjaanId, tipe],
  );
}

export async function selesaikanBagian(c: PoolClient, user: SessionUser, pengerjaanId: string, tipe: Tipe) {
  const p = await assertMilikPeserta(c, pengerjaanId, user.id);
  if (p.status !== 'AKTIF') throw new AppError('Pengerjaan sudah selesai.', 409);

  const bagian = (
    await c.query(
      `SELECT pb.status, p.dijeda_sejak FROM pengerjaan_bagian pb
         JOIN pengerjaan p ON p.id = pb.pengerjaan_id
        WHERE pb.pengerjaan_id = $1 AND pb.tipe = $2 FOR UPDATE OF pb`,
      [pengerjaanId, tipe],
    )
  ).rows[0];
  if (bagian?.status !== 'SEDANG_DIKERJAKAN') throw new AppError('Bagian ini tidak sedang dikerjakan.', 409);
  if (bagian.dijeda_sejak) throw new AppError('Pengerjaan sedang dijeda oleh Pengawas.', 409);

  await c.query(
    `UPDATE pengerjaan_bagian SET status = 'SELESAI', selesai = now()
      WHERE pengerjaan_id = $1 AND tipe = $2`,
    [pengerjaanId, tipe],
  );
  await hitungSkorPilihanGanda(c, pengerjaanId);
  await c.query(
    `UPDATE pengerjaan p SET status = 'SELESAI'
      WHERE p.id = $1 AND p.status = 'AKTIF'
        AND NOT EXISTS (SELECT 1 FROM pengerjaan_bagian pb WHERE pb.pengerjaan_id = p.id AND pb.status <> 'SELESAI')`,
    [pengerjaanId],
  );
}

/** Tampilan satu soal dan daftar nomor. Kunci jawaban dan rubrik tidak pernah dikirim. */
export async function tampilanSoal(
  c: PoolClient,
  user: SessionUser,
  pengerjaanId: string,
  tipe: Tipe,
  nomor: number,
) {
  const p = await assertMilikPeserta(c, pengerjaanId, user.id);

  const bagianRows = (
    await c.query(
      `SELECT pb.tipe, pb.status, pb.jumlah_tersimpan,
              GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
                LEAST(pb.batas, ub.selesai) - now()))))::int AS sisa_detik
         FROM pengerjaan_bagian pb
         JOIN pengerjaan pg ON pg.id = pb.pengerjaan_id
         JOIN ujian_bagian ub ON ub.ujian_id = pg.ujian_id AND ub.tipe = pb.tipe
        WHERE pb.pengerjaan_id = $1`,
      [pengerjaanId],
    )
  ).rows;
  const bagian = bagianRows.find((b) => b.tipe === tipe);
  if (!bagian) throw new AppError('Bagian ujian tidak ditemukan.', 404);

  const statusBagian = {
    pengerjaan: { id: p.id, status: p.status },
    bagian: bagianRows.map((b) => ({
      tipe: b.tipe,
      status: b.status,
      jumlahTersimpan: b.jumlah_tersimpan,
      sisaDetik: b.sisa_detik,
    })),
    nomor: [] as { n: number; soalId: string; terjawab: boolean }[],
    soal: null as null | Record<string, unknown>,
  };
  // Bagian belum dimulai atau sudah selesai: hanya status yang dikembalikan, tanpa soal.
  if (bagian.status !== 'SEDANG_DIKERJAKAN') return statusBagian;

  const daftar = (
    await c.query(
      `SELECT us.urutan, s.id AS soal_id
         FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
        WHERE us.ujian_id = $1 AND s.tipe = $2
        ORDER BY us.urutan`,
      [p.ujian_id, tipe],
    )
  ).rows;
  const terjawab = new Set(
    (await c.query(`SELECT soal_id FROM jawaban WHERE pengerjaan_id = $1 AND tipe = $2`, [pengerjaanId, tipe]))
      .rows.map((r) => r.soal_id as string),
  );

  const item = daftar[nomor - 1];
  if (!item) throw new AppError('Nomor soal tidak ditemukan.', 404);

  const soal = (await c.query(`SELECT id, tipe, isi FROM soal WHERE id = $1`, [item.soal_id])).rows[0];
  const opsi =
    tipe === 'PILIHAN_GANDA'
      ? (await c.query(`SELECT label, teks FROM soal_opsi WHERE soal_id = $1 ORDER BY label`, [item.soal_id])).rows
      : null;
  const nilai =
    (await c.query(`SELECT nilai FROM jawaban WHERE pengerjaan_id = $1 AND soal_id = $2`, [
      pengerjaanId,
      item.soal_id,
    ])).rows[0]?.nilai ?? '';

  return {
    pengerjaan: { id: p.id, status: p.status },
    bagian: bagianRows.map((b) => ({
      tipe: b.tipe,
      status: b.status,
      jumlahTersimpan: b.jumlah_tersimpan,
      sisaDetik: b.sisa_detik,
    })),
    nomor: daftar.map((d, i) => ({ n: i + 1, soalId: d.soal_id, terjawab: terjawab.has(d.soal_id) })),
    soal: {
      n: nomor,
      id: soal.id,
      tipe: soal.tipe,
      isi: soal.isi,
      opsi,
      nilai,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Peserta: daftar ujian
 * ------------------------------------------------------------------ */
export async function daftarUjianPeserta(c: PoolClient, user: SessionUser) {
  const rows = (
    await c.query(
      `SELECT u.id, u.kode, u.judul, u.status, ub.tipe, ub.durasi_menit, ub.mulai, ub.selesai,
              p.id AS pengerjaan_id, p.status AS pengerjaan_status,
              pb.status AS bagian_status
         FROM penugasan_ruang pr
         JOIN ujian u ON u.id = pr.ujian_id
         JOIN ujian_bagian ub ON ub.ujian_id = u.id
         LEFT JOIN pengerjaan p ON p.ujian_id = u.id AND p.user_id = pr.user_id
         LEFT JOIN pengerjaan_bagian pb ON pb.pengerjaan_id = p.id AND pb.tipe = ub.tipe
        WHERE pr.user_id = $1 AND u.bidang_studi_kode = $2
          AND u.status IN ('TERJADWAL', 'AKTIF', 'SELESAI', 'DIPUBLIKASIKAN')
        ORDER BY ub.mulai`,
      [user.id, user.bidangStudiKode],
    )
  ).rows;

  const map = new Map<string, any>();
  for (const r of rows) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id,
        kode: r.kode,
        judul: r.judul,
        status: r.status,
        pengerjaanId: r.pengerjaan_id,
        pengerjaanStatus: r.pengerjaan_status,
        bagian: [],
      });
    }
    map.get(r.id).bagian.push({
      tipe: r.tipe,
      durasiMenit: r.durasi_menit,
      mulai: r.mulai,
      selesai: r.selesai,
      status: r.bagian_status ?? 'BELUM_DIMULAI',
    });
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------ *
 * Pengawas
 * ------------------------------------------------------------------ */
export async function pastikanPengawasRuang(c: PoolClient, pengawasId: string, ujianId: string) {
  const r = await c.query(`SELECT ruang_id FROM penugasan_pengawas WHERE pengawas_id = $1 AND ujian_id = $2`, [
    pengawasId,
    ujianId,
  ]);
  if (r.rowCount === 0) throw new AppError('Anda tidak ditugaskan mengawasi ujian ini.', 403);
  return r.rows.map((x) => x.ruang_id as string);
}

export async function pantauRuang(c: PoolClient, pengawas: SessionUser, ujianId: string) {
  const ruangIds = await pastikanPengawasRuang(c, pengawas.id, ujianId);

  const peserta = (
    await c.query(
      `SELECT pr.user_id, u.nama, u.username, u.bidang_studi_kode, r.kode AS ruang_kode,
              p.id AS pengerjaan_id, COALESCE(p.status, 'BELUM_MULAI') AS status,
              (p.dijeda_sejak IS NOT NULL) AS dijeda, COALESCE(p.pelanggaran_fokus, 0) AS pelanggaran
         FROM penugasan_ruang pr
         JOIN users u ON u.id = pr.user_id
         JOIN ruang_ujian r ON r.id = pr.ruang_id
         LEFT JOIN pengerjaan p ON p.ujian_id = pr.ujian_id AND p.user_id = pr.user_id
        WHERE pr.ujian_id = $1 AND pr.ruang_id = ANY($2::uuid[])
        ORDER BY r.kode, u.nama`,
      [ujianId, ruangIds],
    )
  ).rows;

  const pengerjaanIds = peserta.filter((p) => p.pengerjaan_id).map((p) => p.pengerjaan_id);
  const bagian = pengerjaanIds.length
    ? (
        await c.query(
          `SELECT pb.pengerjaan_id, pb.tipe, pb.status, pb.jumlah_tersimpan,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
                    LEAST(pb.batas, ub.selesai) - now()))))::int AS sisa_detik
             FROM pengerjaan_bagian pb
             JOIN pengerjaan p ON p.id = pb.pengerjaan_id
             JOIN ujian_bagian ub ON ub.ujian_id = p.ujian_id AND ub.tipe = pb.tipe
            WHERE pb.pengerjaan_id = ANY($1::uuid[])`,
          [pengerjaanIds],
        )
      ).rows
    : [];

  const totalSoal = (
    await c.query(
      `SELECT s.tipe, count(*)::int AS jumlah FROM ujian_soal us JOIN soal s ON s.id = us.soal_id
        WHERE us.ujian_id = $1 GROUP BY s.tipe`,
      [ujianId],
    )
  ).rows;

  return {
    totalSoal: Object.fromEntries(totalSoal.map((t) => [t.tipe, t.jumlah])),
    peserta: peserta.map((p) => ({
      userId: p.user_id,
      nama: p.nama,
      username: p.username,
      bidangStudi: p.bidang_studi_kode,
      ruang: p.ruang_kode,
      pengerjaanId: p.pengerjaan_id,
      status: p.status,
      dijeda: p.dijeda,
      pelanggaranFokus: p.pelanggaran,
      bagian: bagian
        .filter((b) => b.pengerjaan_id === p.pengerjaan_id)
        .map((b) => ({ tipe: b.tipe, status: b.status, tersimpan: b.jumlah_tersimpan, sisaDetik: b.sisa_detik })),
    })),
  };
}

export async function jedaPengerjaan(
  c: PoolClient,
  pengawas: SessionUser,
  pengerjaanId: string,
  aksi: 'jeda' | 'lanjut',
) {
  const p = (
    await c.query(
      `SELECT p.id, p.ujian_id, p.ruang_id, p.status, p.dijeda_sejak
         FROM pengerjaan p WHERE p.id = $1 FOR UPDATE`,
      [pengerjaanId],
    )
  ).rows[0];
  if (!p) throw new AppError('Pengerjaan tidak ditemukan.', 404);

  const ruangIds = await pastikanPengawasRuang(c, pengawas.id, p.ujian_id);
  if (!ruangIds.includes(p.ruang_id)) throw new AppError('Peserta ini bukan di ruang yang Anda awasi.', 403);
  if (p.status !== 'AKTIF') throw new AppError('Pengerjaan sudah selesai.', 409);

  if (aksi === 'jeda') {
    if (p.dijeda_sejak) throw new AppError('Pengerjaan sudah dijeda.', 409);
    const sedang = (
      await c.query(`SELECT 1 FROM pengerjaan_bagian WHERE pengerjaan_id = $1 AND status = 'SEDANG_DIKERJAKAN'`, [
        pengerjaanId,
      ])
    ).rowCount;
    if (!sedang) throw new AppError('Tidak ada bagian yang sedang dikerjakan.', 409);
    await c.query(`UPDATE pengerjaan SET dijeda_sejak = now(), dijeda_oleh = $2 WHERE id = $1`, [
      pengerjaanId,
      pengawas.id,
    ]);
  } else {
    if (!p.dijeda_sejak) throw new AppError('Pengerjaan tidak sedang dijeda.', 409);
    // Jeda tidak menambah waktu: batas bagian tidak digeser. Waktu tetap berjalan,
    // jeda hanya memblokir penyimpanan jawaban dan aksi bagian.
    await c.query(`UPDATE pengerjaan SET dijeda_sejak = NULL, dijeda_oleh = NULL WHERE id = $1`, [pengerjaanId]);
  }

  await c.query(
    `INSERT INTO log_aktivitas (pelaku, aksi, target, detail) VALUES ($1, $2, $3, $4)`,
    [pengawas.id, aksi === 'jeda' ? 'PENGERJAAN_DIJEDA' : 'PENGERJAAN_DILANJUTKAN', pengerjaanId, JSON.stringify({})],
  );
}
