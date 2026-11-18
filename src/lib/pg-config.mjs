/**
 * Konfigurasi PostgreSQL yang dipakai bersama oleh Next.js dan CLI pemeriksaan.
 * Periksa sertifikat TLS + hostname, tanpa mengizinkan sslmode=disable / no-verify.
 * Tidak ada secret yang ditulis ke log atau dikirim ke browser.
 */
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';

export class DatabaseConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DatabaseConfigError';
    this.code = code;
  }
}

export function getPgOptions(env = process.env) {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new DatabaseConfigError('DB_CONFIG');
  let url;
  try {
    url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
      throw new Error('Invalid URL');
    }
  } catch {
    throw new DatabaseConfigError('DB_URL');
  }

  // pg-connection-string dapat menimpa opsi SSL jika sslmode masih ada di URL.
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(p);
  }

  const rawCa = env.SUPABASE_DB_CA_CERT?.trim() || env.DATABASE_CA_CERT?.trim();
  const ca = rawCa?.replace(/\\n/g, '\n').trim();
  let ssl = { rejectUnauthorized: true };
  if (ca) {
    const certs = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certs || certs.join('\n').replace(/\s+/g, '') !== ca.replace(/\s+/g, '')) {
      throw new DatabaseConfigError('DB_CA_FORMAT');
    }
    try {
      for (const cert of certs) new X509Certificate(cert);
    } catch {
      throw new DatabaseConfigError('DB_CA_FORMAT');
    }
    // Tambahkan CA Supabase TANPA menghilangkan CA publik sistem Node,
    // karena sertifikat pooler bisa berbeda dari sertifikat endpoint langsung.
    ssl = { rejectUnauthorized: true, ca: [...rootCertificates, ...certs] };
  }
  return { connectionString: url.toString(), ssl };
}
