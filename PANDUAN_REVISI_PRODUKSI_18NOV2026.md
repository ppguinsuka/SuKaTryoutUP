# SuKa Tryout — Revisi setelah audit 18 November 2026

## PENTING: urutan instalasi (pertahankan database dan akun lama)

1. **Cadangkan** repositori GitHub, database PostgreSQL/Supabase, serta Environment Variables Vercel. Berhentikan ujian aktif sebelum penerapan.
2. **Jalankan hanya** `database/003-keandalan-ujian.sql` dari Supabase → SQL Editor **sebelum** deployment kode. File ini menambah `jawaban.client_revision`, tabel `jawaban_ragu`, `pengerjaan.fokus_terakhir`, dan indeks. Migrasi idempoten, tidak menghapus jawaban atau akun. Jangan jalankan ulang `001-schema.sql` atau reset database lama.
3. Salin **seluruh isi ZIP Full** ke repositori, atau salin hanya isi **ZIP Patch** dan timpa file terkait. Pertahankan koneksi database yang sudah terpasang.
4. Pastikan variabel server **Production**: `DATABASE_URL` = URI Supabase Pooler *asli* (transaction pooler 6543 direkomendasikan) dan `SUPABASE_DB_CA_CERT` = sertifikat root CA dalam format PEM bila verifikasi sertifikat memerlukan CA khusus. Nama lama `DATABASE_CA_CERT` masih diterima. Tidak perlu menambahkan `sslmode` dalam URI: TLS diverifikasi oleh driver. Jangan menaruh password atau certificate chain ke `NEXT_PUBLIC_`.
5. Push commit dan deploy ulang **sekali** setelah perubahan dan migrasi selesai. Tunggu deployment berstatus Ready, kemudian buka situs production yang benar.
6. Tes: admin login, buat DRAFT ujian, SEB wajib ON/OFF, impor template kecil, assign ruang, peserta coba jawab PG/esai, muat ulang, pindah nomor, tenggat waktu, hasil & monitoring.
7. `database/004-pemeliharaan-aman.sql` **opsional**. File ini menghapus sesi expired >7 hari dan catatan rate limit lama. Jalankan manual saat ujian tidak berlangsung, setelah Anda meninjau isinya; bukan migrasi wajib.

## Fitur yang sudah diperbaiki dalam kode

- **Identitas**: favicon, ikon web 192/512 dan Apple icon berasal dari **huruf S berbentuk sungai** pada gambar logo terakhir (simbol saja, tanpa teks/toga). Teks antarmuka “SuKa Tryout” dipertahankan.
- **Login**: lapisan biru menurun transparansinya sehingga `login-kampus.jpg` terlihat; koneksi SSL/CA dan pesan diagnostik tetap dipertahankan.
- **SEB**: flag `seb_wajib` dikontrol di server. Untuk ujian wajib SEB, validasi BEK 64 karakter hex dan RequestHash yang sesuai spesifikasi **SHA256(UTF8(URL absolut) || 32-byte BEK)**, dibandingkan constant time. Untuk tidak wajib SEB, tidak memblokir browser normal. Mendukung banyak kunci Windows/macOS yang didaftarkan; **metode HTTP header tidak kompatibel dengan semua browser SEB macOS/iOS modern menggunakan WKWebView**. Belum diuji dengan `.seb`/BEK asli, dan JavaScript API belum diimplementasikan. Jika ujian mewajibkan SEB, uji di perangkat versi SEB sebenarnya sebelum pelaksanaan. Jangan melemahkan pemeriksaan.
- **Waktu**: status `SEDANG_DIKERJAKAN` konsisten; deadline divalidasi server/database; jawaban setelah tenggat ditolak; skor PG dihitung setelah penutupan bagian.
- **Jawaban**: PG autosave segera setelah dipilih; esai autosave 1,8 detik setelah mengetik berhenti, interval ulang 20 detik saat gagal/online; cadangan 24 jam melalui localStorage perangkat yang sama; revisi monoton/ACK. Ini meningkatkan ketahanan listrik/koneksi **namun tidak menjamin nol kehilangan data pada semua kondisi**. Jangan menjanjikan data lokal tersedia setelah cache dihapus atau berpindah perangkat.
- **Tandai Ragu**: status tersimpan pada server dalam `jawaban_ragu`.
- **Fokus**: indikasi perpindahan tab dicatat dengan pembatasan 10 detik; **bukan bukti kecurangan**. Monitoring tidak selalu mengukur setiap perilaku dalam SEB.
- **Panitia**: tabel Peserta dan Soal dengan pencarian, filter dan pagination server 25 baris; bank soal 50 baris/halaman; penugasan dapat memilih banyak peserta/ruang dan disimpan batch SQL, token existing tidak berotasi saat menyimpan penugasan; lebih responsif dari daftar penuh.
- **Impor**: pemeriksaan struktur dan duplikasi sebelum konfirmasi, maksimal 2,5 MB dan 2.500 baris/berkas, validasi magic bytes `.xls/.xlsx`, kolom dan isi sel. **Pratinjau belum merupakan validasi semua aturan bisnis**; transaksi final menolak data jika ada kesalahan. Tidak mengembalikan password peserta dalam pratinjau.
- **Integritas**: soal dan jadwal dikunci bila sudah ada pengerjaan, jadwal PG dan esai divalidasi, jumlah soal minimal, token & BEK sebelum aktivasi; laporan CSV aman dari formula injection; beberapa audit log tambahan.

## Yang masih perlu validasi atau fase berikutnya (jangan diklaim sudah selesai)

- **Uji login & transaksi Supabase production:** belum dapat dijalankan dari lingkungan pengembangan ini. Verifikasi langsung dengan akun pengujian.
- **Build penuh Next.js dan audit dependency:** tidak dapat dijalankan karena dependensi npm tidak dapat diunduh; baru lolos pemeriksaan sintaks TypeScript dan unit test TLS/BEK. Instal dan jalankan `npm ci` setelah membuat lockfile, `npm run typecheck`, `npm run build`, `npm run test:config` pada lingkungan dengan internet sebelum merge/deploy. Jika belum punya lockfile, jalankan `npm install` sekali dan commit `package-lock.json`.
- **`xlsx@0.18.5` lama:** advisory keamanan belum sepenuhnya teratasi; limit dan validasi file hanya mitigasi. Perlu migrasi ke parser yang didukung dengan pengujian kompatibilitas `.xls/.xlsx/.csv`, bukan mengklaim versi sudah aman.
- **Uji beban 200/500/1.000/2.000 peserta:** belum dilakukan; kapasitas serverless dan Supabase belum terbukti. Impor 2.000 peserta masih bisa memerlukan penanganan job batch/worker atau batas eksekusi Vercel.
- **macOS/iOS WKWebView SEB:** integrasi JavaScript API membutuhkan desain sesi dan pengujian keamanan tersendiri. Sementara itu, konfigurasikan ujian SEB berdasarkan engine/versi yang telah diuji pada perangkat peserta. Jangan menonaktifkan validasi demi bypass.
- **Snapshots soal, pemisahan penyimpanan gambar, impor besar asinkron, paginasi daftar ujian & monitoring masif, dan pengujian database dengan data nyata:** fase lanjut setelah uji regresi.

## Perintah tes di terminal

```bash
npm install              # sekali, membuat package-lock.json
npm run test:config      # tes PG TLS dan hash SEB
npm run typecheck
npm run build
```

**Tidak ada koneksi yang saya gunakan untuk memodifikasi Supabase, GitHub, atau Vercel Anda.** ZIP ini berisi kode siap ditinjau; production belum berubah.
