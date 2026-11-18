# SuKaTryoutUP — Perbaikan Login & Tampilan Admin/Panitia

Berdasarkan dua arsip yang diberikan: **SuKaTryoutUP (2).zip** (proyek sasaran) dan **SuKaOlimpiadeFisika-main (4).zip** (referensi tampilan). Tanggal: 18 November 2026.

## Apa yang diperbaiki

1. **Perbaikan penyebab DB_SSL yang teridentifikasi pada berkas**: kode semula membaca `DATABASE_CA_CERT`, sementara konfigurasi Vercel dari petunjuk sebelumnya memakai `SUPABASE_DB_CA_CERT`. Sekarang **keduanya didukung**, dengan prioritas `SUPABASE_DB_CA_CERT`.
2. Opsi `sslmode`, `sslcert`, `sslkey`, `sslrootcert` di URI dihapus sebelum diteruskan ke `pg` agar tidak menimpa `ssl` eksplisit. Koneksi tetap `rejectUnauthorized: true` dan memverifikasi hostname. Jika CA dari Supabase diberikan, digabungkan dengan CA bawaan Node (agar sertifikat pooler dengan CA publik tetap dapat diverifikasi).
3. Pool PostgreSQL baru dibuat saat query pertama, sehingga konfigurasi yang salah ditangani API dengan pesan kode diagnostik yang aman. `DB_CONFIG`, `DB_URL`, `DB_CA_FORMAT`, `DB_SSL`, `DB_AUTH`, `DB_NETWORK`, `DB_SCHEMA`.
4. Login ditata ulang dengan estetika **SuKa Olimpiade** (panel branding gradasi biru, form putih, tombol/ikon modern), tanpa mengubah peran atau autentikasi.
5. Panel **Admin / Panitia** kini memiliki menu **Dashboard** sebagai halaman awal, empat kartu statistik dari DB, tabel ujian terbaru, enam akses cepat, sidebar dan topbar selaras referensi visual. Semua tab dan fungsi lama tetap ada.
6. SQL skema asli dipertahankan. Tidak ada migrasi, TRUNCATE, penghapusan data, reset akun, maupun perubahan kata sandi.

## Memasang pada GitHub / Vercel

1. **Cadangkan repo atau buat branch baru**, misalnya `fix/login-dashboard-panitia`.
2. Ekstrak ZIP ini, salin **isi folder `sukatryoutup/`** ke root proyek GitHub SuKaTryoutUP Anda, lakukan commit/push. Jangan salin folder itu menjadi subfolder baru apabila root repo semula sudah memuat `package.json`.
3. Vercel → proyek SuKaTryoutUP yang benar → Settings → Environment Variables → **Production**:

   - `DATABASE_URL`: URI asli dari **Supabase Connect → Transaction Pooler**, biasanya port **6543**, termasuk password yang URL-encoded. Untuk parameter `sslmode` di URL boleh dibiarkan; kode sekarang mengabaikan pengaturan `sslmode` URL dan SELALU mengaktifkan verifikasi TLS.
   - `SUPABASE_DB_CA_CERT`: sertifikat CA asli Supabase pada proyek database ini, persis seluruh PEM `BEGIN CERTIFICATE...END CERTIFICATE`. Boleh multi-line atau `\\n` literal. Jika sebelumnya memakai `DATABASE_CA_CERT`, kode tetap mendukungnya, tetapi disarankan memakai nama baru secara konsisten.
   - `SEB_ALLOW_UNCONFIGURED=false` untuk produksi dengan SEB.

4. Redeploy **Production** dengan pengaturan environment yang baru; kemudian buka `/login` dan masuk dengan akun lama (tidak perlu membuat ulang akun).
5. Jika masih ada galat, lihat kode di UI dan **Vercel Runtime Logs**. Jangan kirim password, URI, atau PEM ke chat/log publik.

> Catatan penting: Sertifikat CA bukan kunci privat, tetapi tetap simpan pada server Vercel dan jangan gunakan opsi `rejectUnauthorized:false`, `sslmode=disable`, atau `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Pemeriksaan database (tidak mengubah data)

Setelah menyalin `.env.example` ke `.env.local` dan mengisi DB:

```bash
npm install
npm run test:config
npm run db:check
npm run typecheck
npm run build
```

`db:check` melakukan pengecekan *read-only*: koneksi TLS, keberadaan tabel inti, jumlah tabel, dan akun Super Admin aktif. Perintah ini **tidak membuat/mereset admin**.

Jika DB_SSL tetap muncul, periksa apakah `SUPABASE_DB_CA_CERT` benar-benar di-set pada environment deployment dan apakah sertifikatnya adalah CA yang sesuai. Periksa juga hostname/port yang disalin dari panel Supabase Connect (bukan host `supabase.com` generik). Jika `DB_AUTH`, verifikasi kredensial pooler. Jika `DB_SCHEMA`, cocokkan skema tanpa menghapus data.

## Yang sudah dan belum diuji

- **Lulus**: tes konfigurasi SSL berbasis Node (`npm run test:config`) — 6/6.
- **Lulus**: pemeriksaan sintaks/transpilasi 29 file TypeScript/TSX dalam paket.
- **Belum teruji**: `npm run build` dan pengujian end-to-end login terhadap database aktual; registry npm tidak dapat dijangkau oleh lingkungan penyusunan (EAI_AGAIN), dan kredensial database SuKaTryoutUP tidak tersedia.

Karena itu, login yang berhasil **harus divalidasi pada Preview/Production Vercel** setelah deploy; jangan menganggapnya terverifikasi tanpa pengujian tersebut.

## Tabel/fungsi yang dipertahankan

Login & sesi: `users`, `sessions`, `login_limits`. Panitia: ujian dua sesi PG & Esai, soal/rubrik, SEB, token per ruang/sama, ruang, peserta + impor CSV, pengawas, penugasan, ekspor nilai esai, impor nilai, publikasi hasil. Peserta: pakta integritas, pengerjaan dan hasil. Pengawas: monitoring, jeda/lanjut.

**Penting:** jangan menjalankan ulang skrip SQL awal pada database berisi data tanpa audit. Tidak diperlukan migrasi SQL untuk update tampilan dan koneksi ini.
