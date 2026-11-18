import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { getPgOptions, DatabaseConfigError } from '../src/lib/pg-config.mjs';

const DATABASE_URL = 'postgresql://postgres.test:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full';

test('TLS memverifikasi sertifikat dan hostname; sslmode URL tidak menimpa opsi pg', () => {
  const cfg = getPgOptions({ DATABASE_URL });
  assert.equal(cfg.ssl.rejectUnauthorized, true);
  assert.equal(new URL(cfg.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(cfg.connectionString).password, 'p%40ss');
});

test('SUPABASE_DB_CA_CERT diterima dan menambah daftar CA sistem', () => {
  const cfg = getPgOptions({ DATABASE_URL, SUPABASE_DB_CA_CERT: rootCertificates[0] });
  assert.ok(Array.isArray(cfg.ssl.ca));
  assert.equal(cfg.ssl.ca.length, rootCertificates.length + 1);
  assert.equal(cfg.ssl.rejectUnauthorized, true);
});

test('DATABASE_CA_CERT lama tetap kompatibel', () => {
  const cfg = getPgOptions({ DATABASE_URL, DATABASE_CA_CERT: rootCertificates[0] });
  assert.equal(cfg.ssl.ca.length, rootCertificates.length + 1);
});

test('sertifikat malformed ditolak dengan DB_CA_FORMAT', () => {
  assert.throws(() => getPgOptions({ DATABASE_URL, SUPABASE_DB_CA_CERT: 'invalid certificate' }), (error) => error instanceof DatabaseConfigError && error.code === 'DB_CA_FORMAT');
});

test('URL hilang/salah ditolak dengan kode eksplisit', () => {
  assert.throws(() => getPgOptions({}), (error) => error.code === 'DB_CONFIG');
  assert.throws(() => getPgOptions({ DATABASE_URL: 'invalid' }), (error) => error.code === 'DB_URL');
});

test('SSL tidak boleh bisa dimatikan dari parameter URL', () => {
  const cfg = getPgOptions({ DATABASE_URL: DATABASE_URL.replace('verify-full', 'disable') });
  assert.equal(cfg.ssl.rejectUnauthorized, true);
  assert.ok(!cfg.connectionString.includes('sslmode=disable'));
});
