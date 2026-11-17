# PATCH DIAGNOSTIK LOGIN — SuKaTryoutUP

Patch ini **bukan** pengganti konfigurasi Supabase. Patch mengubah pesan galat agar masalah server lebih mudah diidentifikasi, dan menambahkan pemeriksaan database read-only. Tidak memodifikasi schema, akun, atau data.

## Berkas yang perlu diganti / ditambahkan

1. **Ganti** `src/lib/errors.ts` dengan file dari patch.
2. **Ganti** `package.json` dengan file dari patch (tambahan perintah `db:check`).
3. **Tambahkan** `scripts/check-db.mjs` dari patch.

Lakukan commit/push ke repo proyek SuKaTryoutUP lalu lakukan deploy (termasuk env Production) di Vercel. Jangan memasang patch ini pada proyek lain.

## Persiapan

- Supabase > Connect > Transaction Pooler: salin URI, dengan port `6543`.
- Vercel > Project > Settings > Environment Variables: tambah `DATABASE_URL` untuk Production, lalu redeploy.
- Peringatan `pg-connection-string` tentang `sslmode=require` **bukan** error login. Untuk mempertahankan verifikasi TLS saat ini, gunakan `sslmode=verify-full` dengan sertifikat CA tepercaya jika dibutuhkan. Jangan gunakan `sslmode=disable` atau `rejectUnauthorized: false` sebagai solusi.
- Password pada URI harus di-URL-encode jika mengandung karakter khusus (`@`, `#`, `/`, `?`, `:`, `%`).
- Jangan pernah membagikan `DATABASE_URL` atau menyimpannya di GitHub.
- Jalankan file `database/001-schema.sql` **hanya pada proyek Supabase yang benar** jika tabel belum ada; jangan jalankan ulang sembarangan pada database berisi data tanpa audit.

## Diagnostik lokal

1. Buat `.env.local` di root proyek berisi `DATABASE_URL` asli (jangan di-commit).
2. Jalankan `npm install`, lalu `npm run db:check`.
3. Perhatikan hasil: koneksi, 21 tabel, Super Admin, dan hak akses dasar.

## Diagnostik deployment

Buka halaman login dan coba kembali setelah deploy. Kode diagnosis yang mungkin tampil:

| Kode | Arti | Langkah |
|---|---|---|
| DB_CONFIG | `DATABASE_URL` tidak diset pada runtime | Periksa Vercel Environment Variables dan redeploy |
| DB_URL | Format URL salah | Salin ulang URI Supabase dari menu Connect |
| DB_AUTH | Login database ditolak | Periksa password database, username pooler dan project ref |
| DB_NETWORK | Tidak bisa menjangkau host database | Periksa region/host pooler dan status Supabase |
| DB_SSL | Sertifikat TLS PostgreSQL tidak bisa diverifikasi | Periksa CA Supabase, hostname, dan konfigurasi SSL |
| DB_SCHEMA | Tabel database tidak ditemukan | Cek SQL schema di database yang dipakai Vercel |
| SERVER_ERROR | Kesalahan lain | Buka Vercel Logs dan lihat detail lengkap |

Jika salah satu kode sudah tampil, bagikan **kodenya saja** untuk diagnosis lanjutan; jangan bagikan password, token atau URL database.
