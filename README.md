# SuKaTryoutUP

Aplikasi tryout berbasis Next.js (App Router), PostgreSQL (Supabase), dan Safe Exam Browser (SEB).
Deploy: Vercel. Database: Supabase (Transaction pooler, port 6543).

> **Update 18 November 2026:** perbaikan SSL/login dan dashboard Panitia bergaya SuKa Olimpiade. Baca `PANDUAN_PERBAIKAN_18NOV2026.md` sebelum deploy.

## Fitur

- Login username dan password, dengan pembatasan percobaan login.
- Empat role: SUPER_ADMIN, PANITIA, PENGAWAS, PESERTA.
- **Panitia** (`/panitia`): dashboard statistik, sidebar bergaya SuKa Olimpiade, ruang, peserta (termasuk impor CSV), pengawas, soal (pilihan ganda dan esai dengan rubrik), ujian (jadwal dua bagian, soal, SEB, mode token), penugasan peserta ke ruang dan pengawas ke ruang, ekspor esai untuk koreksi AI, impor nilai esai, dan publikasi hasil.
- **Peserta**: dashboard jadwal dua bagian, token, pakta integritas, pengerjaan satu soal per halaman, grid nomor, tandai ragu, timer dari server, dan hasil yang sudah dipublikasikan. Esai terkunci sampai pilihan ganda selesai.
- **Pengawas** (`/pengawas`): status peserta per ruang, jumlah jawaban tersimpan, sisa waktu, dan jeda/lanjut. Jeda tidak menambah waktu; waktu tetap berjalan dan jeda hanya memblokir penyimpanan.

## Aturan yang dipakai

- Pilihan ganda dinilai sebagai jumlah jawaban benar. Esai dinilai 0–100 dan dinilai terpisah.
- Skor esai = rata-rata seluruh soal esai ujian, dengan soal yang tidak dijawab dihitung 0.
- Satu kali percobaan per peserta per ujian.
- Peserta hanya melihat ujian untuk Bidang Studi yang ditetapkan Panitia.
- Ujian yang sudah dikerjakan peserta tidak bisa diubah jadwal, soal, dan penugasannya.
- Soal yang sudah dipakai ujian aktif atau selesai tidak bisa diubah.
- Satu peserta hanya boleh punya satu pengerjaan aktif dalam satu waktu.

## Belum ada

- Impor nilai esai dalam format XLSX (saat ini CSV).
- Penyimpanan status ragu-ragu di server (saat ini hanya di browser).
- Pengelolaan konfigurasi SEB dan BEK dari antarmuka (saat ini lewat SQL Editor).
- Halaman riwayat impor (data tersimpan di tabel `impor_nilai`).

## Menjalankan lokal

1. Salin `.env.example` menjadi `.env.local`, lalu isi `DATABASE_URL` dan `SUPABASE_DB_CA_CERT` (jika sertifikat CA Supabase diperlukan).
2. Jalankan `database/001-schema.sql` di SQL Editor Supabase.
3. Buat akun pertama. Jangan memakai "Add user" di dashboard Supabase, karena itu membuat akun Supabase Auth yang tidak dipakai aplikasi ini.
   ```bash
   npm run db:create-user -- --username admin --nama "Super Admin" --role SUPER_ADMIN --password "password-minimal-12"
   ```
   Skrip mencetak perintah `INSERT` berisi hash password. Tempel perintah itu di SQL Editor Supabase lalu jalankan.
4. Tambahkan file logo UIN Sunan Kalijaga Yogyakarta di `public/logo-uin.png`.
5. `npm install`, lalu `npm run test:config`, `npm run db:check`, `npm run typecheck`, dan `npm run dev`.
6. Buka `/login`, masuk sebagai Panitia, lalu isi data berurutan: ruang, peserta, pengawas, soal, ujian, penugasan.

## Konfigurasi SEB

- SEB mengirim header `X-SafeExamBrowser-RequestHash` = SHA-256(URL + Browser Exam Key).
- Simpan BEK di tabel `seb_konfigurasi`, lalu hubungkan ke ujian lewat `ujian_seb`.
- Ujian yang mewajibkan SEB ditolak jika tidak ada konfigurasi yang cocok. `SEB_ALLOW_UNCONFIGURED=true` hanya untuk pengembangan.
- Pastikan URL yang diterima server sama dengan URL publik. Di balik proxy, periksa host dan protokolnya.

## Keamanan

- Semua tabel memakai RLS tanpa policy. Aplikasi mengakses database lewat `DATABASE_URL` (pemilik tabel), sehingga tidak terkena RLS. Jangan gunakan anon key untuk akses data dari aplikasi.
- Token ujian disimpan sebagai teks biasa agar Panitia bisa melihatnya. Pertimbangkan hashing jika kebijakan menuntutnya.

## Catatan

- Kode ini belum dijalankan dan diuji end-to-end. Jalankan `npm run typecheck` dan `npm run build` sebelum deploy, lalu uji skenario Panitia, Pengawas, dan Peserta.
- Jalankan uji beban sebelum hari H, dengan target 2000 peserta serentak.

## Impor Excel dan editor WYSIWYG (v3)

- **Semua impor memakai template Excel.** Unduh template dari panel Panitia (tombol *Unduh Template Excel*), isi, lalu unggah berkas `.xlsx` (atau `.csv`).
  - Impor peserta: `template-impor-peserta.xlsx` (sheet *Peserta*, *Kode Bidang*, *Petunjuk*).
  - Impor soal: `template-impor-soal.xlsx` (kolom: kode, bidang, tipe, isi, opsi_a–opsi_e, kunci, rubrik, status). Soal divalidasi semua sebelum disimpan. Gambar ditambahkan lewat editor setelah impor.
  - Impor nilai esai: `template-impor-nilai-esai.xlsx`. Ambil `pengerjaan_id` dan `soal_id` dari ekspor esai.
  - Satu baris salah membatalkan seluruh impor.
- **Editor WYSIWYG** untuk isi soal, teks opsi, dan rubrik esai (toolbar: tebal, miring, garis bawah, judul, daftar, tautan, gambar, tabel, undo/redo, source HTML).
- **Gambar disimpan sebagai base64** langsung di dalam konten. Gambar dikecilkan di browser (lebar maks. 1000 px, JPEG) agar ukurannya wajar.
- Konten dibersihkan di server (`src/lib/sanitize.ts`, allowlist `sanitize-html`): script, event handler, dan tautan selain http(s)/mailto dibuang. Gambar hanya diterima dalam bentuk data URI base64.
- Dependensi baru: `xlsx`, `sanitize-html`, `@types/sanitize-html`. Jalankan `npm install` setelah mengambil perubahan ini.

### Konfigurasi SEB dari panel Panitia
- Tab **Ujian** memiliki kartu *Konfigurasi SEB*: tambah konfigurasi (nama, platform, Browser Exam Key), lalu aktifkan atau nonaktifkan.
- BEK disimpan di server dan tidak pernah dikirim balik ke browser. BEK hanya bisa dimasukkan ulang, bukan dibaca.
- Hubungkan konfigurasi ke ujian lewat checkbox *Konfigurasi SEB* pada form ujian.

### Revisi terbaru
- **Login**: panel biru menampilkan foto kampus (`public/login-kampus.jpg`).
- **Impor Excel** untuk Peserta, Soal, Pengawas, Ruang, dan Nilai Esai. Setiap impor memiliki tombol *Unduh Template Excel* dan petunjuk bernomor. Impor bersifat seluruh-atau-tidak-sama-sekali.
- **Monitoring Super Admin** (tab *Monitoring*): pilih ujian, lalu klik baris ruang untuk memantau peserta ruang tersebut, lengkap dengan Jeda dan Lanjutkan. Tampilannya sama dengan dashboard pengawas.
- **Log Aktivitas** (tab baru): 200 aktivitas terakhir, yaitu impor, reset password, salin ujian, publikasi, dan pengiriman berita acara.
- **Reset password peserta**: tombol di tabel peserta. Password baru dibuat server, hanya ditampilkan sekali, dan sesi peserta lama diakhiri.
- **Salin ujian**: menyalin judul, bagian dan jadwal, soal, SEB, penugasan ruang dan pengawas, serta membuat token baru per ruang. Hasil peserta tidak disalin. Hasil salinan berstatus DRAFT.
- **Unduh Hasil (Excel)** di tab Nilai Esai & Hasil.
- **Berita Acara** (tab baru): per ruang, berisi peserta, status, pelanggaran fokus, dan jeda. Tombol **Kirim** aktif setelah waktu ujian berakhir. Setelah dikirim, isi berita acara disimpan sebagai salinan dan tidak berubah.

**Migrasi database:** untuk database yang sudah berjalan, jalankan `database/002-berita-acara.sql` sekali di Supabase SQL Editor. Database baru cukup dengan `001-schema.sql`.
