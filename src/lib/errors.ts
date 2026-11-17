/** Pesan galat API tidak boleh mengungkap password, host, atau query database. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

type ErrorInfo = { code?: string; message?: string; cause?: unknown; errors?: unknown[] };
type Diagnosis = { kode: string; pesan: string; status: number };

/** Klasifikasi aman untuk ditampilkan pada layar login. */
function diagnosisServer(err: unknown): Diagnosis {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return {
      kode: 'DB_CONFIG', status: 503,
      pesan: 'Koneksi database belum dikonfigurasi di server. Hubungi administrator. (DB_CONFIG)',
    };
  }
  try {
    const dbUrl = new URL(url);
    if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol) || !dbUrl.hostname || !dbUrl.username) {
      throw new Error('Invalid Postgres URL');
    }
  } catch {
    return {
      kode: 'DB_URL', status: 503,
      pesan: 'Format koneksi database tidak valid. Hubungi administrator. (DB_URL)',
    };
  }
  const e = (err ?? {}) as ErrorInfo;
  const nested = Array.isArray(e.errors) ? e.errors : [];
  const candidates: ErrorInfo[] = [e, e.cause as ErrorInfo, ...(nested as ErrorInfo[])].filter(Boolean);
  const codes = candidates.map((item) => typeof item?.code === 'string' ? item.code : '');
  const text = candidates.map((item) => typeof item?.message === 'string' ? item.message : '').join(' ').toLowerCase();
  if (codes.some((code) => [
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ].includes(code)) || /certificate verify failed|self.signed certificate|unable to verify the first certificate/.test(text)) return {
    kode: 'DB_SSL', status: 503,
    pesan: 'Verifikasi sertifikat SSL database gagal. Hubungi administrator. (DB_SSL)',
  };
  if (codes.includes('42P01')) return {
    kode: 'DB_SCHEMA', status: 503,
    pesan: 'Tabel database aplikasi belum lengkap. Hubungi administrator. (DB_SCHEMA)',
  };
  if (codes.some((code) => ['28P01', '28000', '3D000'].includes(code)) ||
    /password authentication failed|tenant or user not found|role .+ does not exist/.test(text)) {
    return {
      kode: 'DB_AUTH', status: 503,
      pesan: 'Kredensial atau tujuan koneksi database ditolak. Hubungi administrator. (DB_AUTH)',
    };
  }
  if (codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
      '08001', '08006', '57P01', '53300'].includes(code)) ||
    /connection terminated|connection timeout|timeout exceeded|server closed the connection/.test(text)) {
    return {
      kode: 'DB_NETWORK', status: 503,
      pesan: 'Server belum berhasil terhubung ke database. Hubungi administrator. (DB_NETWORK)',
    };
  }
  return {
    kode: 'SERVER_ERROR', status: 500,
    pesan: 'Terjadi gangguan server. Hubungi administrator dengan kode SERVER_ERROR.',
  };
}

export function jsonError(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ ok: false, error: err.message }, {
      status: err.status, headers: { 'Cache-Control': 'no-store' },
    });
  }
  const d = diagnosisServer(err);
  const e = (err ?? {}) as ErrorInfo;
  // Kode teknis untuk log, tanpa menampilkan string koneksi atau password database.
  // Hindari menuliskan URI koneksi atau password ke log.
  console.error('[sukatryoutup]', d.kode, 'pgCode=', e.code ?? 'none',
    'errorType=', (err instanceof Error ? err.name : 'unknown'));
  return Response.json({ ok: false, error: d.pesan, kode: d.kode }, {
    status: d.status, headers: { 'Cache-Control': 'no-store' },
  });
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}
