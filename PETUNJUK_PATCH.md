# PATCH SSL CA (DB_SSL) — SuKaTryoutUP

Perbaikan khusus untuk respons login `Verifikasi sertifikat SSL database gagal (DB_SSL)` pada aplikasi Next.js `pg` + Supabase. Tidak mengubah tabel/database, kata sandi, role, logika login, atau pengaturan RLS.

## 1. Ganti 2 file di repo SuKaTryoutUP

- **GANTI** `src/lib/db.ts` dengan file patch.
- **GANTI** `scripts/check-db.mjs` jika patch diagnostik login sebelumnya telah terpasang (direkomendasikan agar hasil tes menggunakan konfigurasi SSL yang sama). Jika belum terpasang, file ini dapat **DITAMBAHKAN**, tetapi `npm run db:check` juga perlu skrip pada package.json dari patch diagnostik sebelumnya.

Tidak perlu mengganti `src/lib/errors.ts` atau `package.json` jika patch diagnostik sebelumnya sudah terpasang.

## 2. Ambil sertifikat CA asli (per proyek)

Supabase Dashboard > pilih proyek **SuKaTryoutUP yang benar** > **Project Settings > Database > SSL Configuration** > **Download CA certificate**. Di beberapa versi dashboard, lokasinya **Database Settings > SSL Configuration**. Buka berkas `.crt` / `.cer` dengan editor teks, lalu salin keseluruhan isi PEM dari `-----BEGIN CERTIFICATE-----` sampai `-----END CERTIFICATE-----`.

PENTING: jangan membuat sertifikat sendiri dan jangan mengambil sertifikat dari proyek berbeda. Jika error berubah menjadi `ERR_TLS_CERT_ALTNAME_INVALID`, cek host pooler dari panel Connect dan kecocokan hostname.

## 3. Atur variabel Vercel (server-only)

Vercel > Project SuKaTryoutUP > Settings > Environment Variables > Production:

- `DATABASE_URL`: salin **Connection string > Transaction Pooler** langsung dari panel Supabase Connect; biasanya `postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres` (bentuk host tergantung proyek). JANGAN kirim URL rahasia ini kepada siapa pun atau commit ke Git. Sebaiknya tanpa `?sslmode=...` karena patch mengatur SSL langsung.
- `SUPABASE_DB_CA_CERT`: tempel **seluruh PEM sertifikat CA** yang diunduh dari Supabase. Nilai dapat multi-baris; patch juga menerima newline yang tertulis sebagai `\n`.

Patch ini menggunakan `ssl: { ca: ..., rejectUnauthorized: true }`, sehingga TLS dan pemeriksaan identitas server tetap aktif. Tidak memakai `rejectUnauthorized: false`, `sslmode=disable`, ataupun `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## 4. Deploy dan tes

Commit kedua file, push ke repo yang benar, redeploy Vercel **Production**, dan coba login.

Jika menguji lokal, simpan `DATABASE_URL` dan `SUPABASE_DB_CA_CERT` di `.env.local` (jangan di-commit) dan gunakan `npm run db:check` jika skrip telah terdaftar pada package.json. Pastikan hasil tes koneksi dan tabel; jangan menaruh kredensial di chat atau log.

Jika tetap DB_SSL, baca **Vercel > Logs** saat percobaan login dan kirim HANYA kode `pgCode` (contoh `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`, atau `CERT_HAS_EXPIRED`) tanpa URI/password.

## Rujukan

- https://supabase.com/docs/guides/platform/ssl-enforcement
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://node-postgres.com/features/ssl

**Status verifikasi:** sintaks check-db dan struktur patch diperiksa secara lokal; koneksi/sertifikat proyek SuKaTryoutUP tidak tersedia untuk diuji. Tidak ada perubahan pada server pengguna.
