/** Galat untuk aturan aplikasi; rincian driver/database tidak dikirim ke klien. */
export class AppError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

type Failure = { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
type Diagnosis = { kode: string; pesan: string };

function diagnose(err: unknown): Diagnosis {
  const initial = (err ?? {}) as Failure;
  const candidates: Failure[] = [initial, initial.cause as Failure, ...(Array.isArray(initial.errors) ? initial.errors as Failure[] : [])].filter(Boolean);
  const codes = candidates.map((e) => e.code ?? '');
  const has = (...values: string[]) => codes.some((c) => values.includes(c));
  if (has('DB_CONFIG')) return { kode: 'DB_CONFIG', pesan: 'DATABASE_URL belum diatur pada server.' };
  if (has('DB_URL')) return { kode: 'DB_URL', pesan: 'Format DATABASE_URL tidak valid.' };
  if (has('DB_CA_FORMAT')) return { kode: 'DB_CA_FORMAT', pesan: 'Format sertifikat CA database tidak valid.' };
  if (has('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_UNTRUSTED', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED')) {
    return { kode: 'DB_SSL', pesan: 'Verifikasi sertifikat SSL database gagal.' };
  }
  if (has('42P01', '42703')) return { kode: 'DB_SCHEMA', pesan: 'Struktur tabel database aplikasi belum sesuai.' };
  if (has('28P01', '28000', '3D000')) return { kode: 'DB_AUTH', pesan: 'Kredensial atau tujuan database ditolak.' };
  if (has('ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', '08001', '08006', '57P01', '53300')) {
    return { kode: 'DB_NETWORK', pesan: 'Koneksi ke server database tidak berhasil.' };
  }
  return { kode: 'SERVER_ERROR', pesan: 'Terjadi gangguan server.' };
}

export function jsonError(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ ok: false, error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const diagnosis = diagnose(err);
  const e = (err ?? {}) as Failure;
  const nested = (e.cause ?? {}) as Failure;
  console.error('[sukatryoutup]', diagnosis.kode, 'pgCode=', e.code ?? nested.code ?? 'none', 'type=', e.name ?? 'unknown');
  return Response.json({
    ok: false,
    error: `${diagnosis.pesan} Hubungi administrator. (${diagnosis.kode})`,
    kode: diagnosis.kode,
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}
