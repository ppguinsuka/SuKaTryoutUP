// Membuat SQL untuk menambah akun (Super Admin, Panitia, Pengawas, atau Peserta).
// Skrip ini TIDAK terhubung ke database. Ia hanya mencetak hash password dan perintah INSERT,
// lalu Anda tempel perintah itu di SQL Editor Supabase.
//
// Contoh:
//   node scripts/create-user.mjs --username admin --nama "Super Admin" --role SUPER_ADMIN --password "password-minimal-12"
//   node scripts/create-user.mjs --username 2025001 --nama "Ahmad" --role PESERTA --bidang 237 --password "password-minimal-12"
//   node scripts/create-user.mjs --username pengawas1 --nama "Budi" --role PENGAWAS --password "password-minimal-12"
//
// Catatan: "Add user" di dashboard Supabase membuat akun Supabase Auth, bukan tabel users aplikasi.
// Jangan gunakan fitur itu untuk akun aplikasi ini.
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const ROLES = ['SUPER_ADMIN', 'PANITIA', 'PENGAWAS', 'PESERTA'];

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key?.startsWith('--')) fail(`Argumen tidak dikenal: ${key}`);
  args[key.slice(2)] = process.argv[i + 1];
}

const { username, nama, role, bidang, password } = args;
if (!username || !nama || !role || !password) fail('Wajib: --username, --nama, --role, --password');
if (!ROLES.includes(role)) fail(`Role harus salah satu dari: ${ROLES.join(', ')}`);
if (role === 'PESERTA' && !/^[0-9]{3}$/.test(bidang ?? '')) {
  fail('Peserta wajib punya --bidang berupa kode 3 digit, mis. 237.');
}
if (role !== 'PESERTA' && bidang) fail('--bidang hanya untuk role PESERTA.');
if (password.length < 12) fail('Password minimal 12 karakter.');

// Format hash harus sama dengan src/lib/auth.ts: scrypt$<salt hex>$<key hex>
const salt = randomBytes(16);
const key = await scrypt(password, salt, 64);
const hash = `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;

const esc = (s) => s.replace(/'/g, "''");
const sql = `INSERT INTO users (username, password_hash, nama, role, bidang_studi_kode)
VALUES ('${esc(username)}', '${hash}', '${esc(nama)}', '${role}', ${role === 'PESERTA' ? `'${bidang}'` : 'NULL'});`;

console.log('-- Tempel perintah berikut di SQL Editor Supabase:\n');
console.log(sql);
console.log('\n-- Setelah berhasil, hapus riwayat terminal yang memuat password Anda.');

function fail(msg) {
  console.error(`Gagal: ${msg}`);
  process.exit(1);
}
