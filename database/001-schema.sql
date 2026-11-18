-- SuKaTryoutUP: skema awal (PostgreSQL / Supabase)
-- Catatan: constraint yang tidak bisa diekspresikan sepenuhnya di SQL (mis. urutan bagian,
-- kecocokan Bidang Studi soal dengan ujian) juga dicek di server.

BEGIN;

-- ============================================================
-- Master
-- ============================================================
CREATE TABLE IF NOT EXISTS bidang_studi (
  kode  text PRIMARY KEY CHECK (kode ~ '^[0-9]{3}$'),
  nama  text NOT NULL
);

INSERT INTO bidang_studi (kode, nama) VALUES
  ('237', 'Fiqh'),
  ('236', 'Qur''an Hadist'),
  ('235', 'Akidah Akhlak'),
  ('238', 'Sejarah Kebudayaan Islam'),
  ('239', 'Bahasa Arab'),
  ('021', 'Guru Kelas RA'),
  ('028', 'Guru Kelas MI'),
  ('127', 'Pendidikan Agama Islam')
ON CONFLICT (kode) DO NOTHING;

CREATE TABLE IF NOT EXISTS ruang_ujian (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode       text NOT NULL UNIQUE,
  nama       text NOT NULL,
  kapasitas  integer NOT NULL CHECK (kapasitas > 0)
);

CREATE TABLE IF NOT EXISTS seb_konfigurasi (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama      text NOT NULL,
  platform  text NOT NULL CHECK (platform IN ('WINDOWS', 'MACOS')),
  bek       text NOT NULL UNIQUE,          -- BEK asli (hex; rahasia server). RequestHash=SHA256(URL UTF8 || 32 byte BEK)
  aktif     boolean NOT NULL DEFAULT true
);

-- ============================================================
-- Pengguna & sesi
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username           text NOT NULL,
  password_hash      text NOT NULL,
  nama               text NOT NULL,
  role               text NOT NULL CHECK (role IN ('SUPER_ADMIN', 'PANITIA', 'PENGAWAS', 'PESERTA')),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  bidang_studi_kode  text REFERENCES bidang_studi(kode),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_peserta_wajib_bidang
    CHECK (role <> 'PESERTA' OR bidang_studi_kode IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unik ON users (lower(username));
CREATE INDEX IF NOT EXISTS users_bidang_idx ON users (bidang_studi_kode) WHERE role = 'PESERTA';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_limits (
  id            text PRIMARY KEY,           -- hash(IP + username)
  failures      integer NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Ujian
-- ============================================================
CREATE TABLE IF NOT EXISTS ujian (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode               text NOT NULL UNIQUE,
  judul              text NOT NULL,
  bidang_studi_kode  text NOT NULL REFERENCES bidang_studi(kode),
  mode_token         text NOT NULL DEFAULT 'PER_RUANG' CHECK (mode_token IN ('PER_RUANG', 'SAMA')),
  token_sama         text CHECK (token_sama ~ '^[A-Za-z0-9]{6}$'),
  seb_wajib          boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'TERJADWAL', 'AKTIF', 'SELESAI', 'DIPUBLIKASIKAN', 'ARSIP')),
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ujian_token_sama_wajib
    CHECK (mode_token <> 'SAMA' OR token_sama IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ujian_bidang_idx ON ujian (bidang_studi_kode);

-- Setiap ujian punya tepat dua bagian, masing-masing dengan durasi dan jadwal sendiri.
CREATE TABLE IF NOT EXISTS ujian_bagian (
  ujian_id       uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  tipe           text NOT NULL CHECK (tipe IN ('PILIHAN_GANDA', 'ESAI')),
  durasi_menit   integer NOT NULL CHECK (durasi_menit > 0),
  mulai          timestamptz NOT NULL,
  selesai        timestamptz NOT NULL,
  PRIMARY KEY (ujian_id, tipe),
  CONSTRAINT ujian_bagian_jadwal CHECK (selesai > mulai)
);

CREATE TABLE IF NOT EXISTS ujian_seb (
  ujian_id        uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  konfigurasi_id  uuid NOT NULL REFERENCES seb_konfigurasi(id),
  PRIMARY KEY (ujian_id, konfigurasi_id)
);

-- Token per ruang (dipakai saat mode_token = PER_RUANG).
CREATE TABLE IF NOT EXISTS ujian_ruang_token (
  ujian_id  uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  ruang_id  uuid NOT NULL REFERENCES ruang_ujian(id),
  token     text NOT NULL CHECK (token ~ '^[A-Za-z0-9]{6}$'),
  PRIMARY KEY (ujian_id, ruang_id)
);

-- Penugasan peserta ke ruang untuk satu ujian.
CREATE TABLE IF NOT EXISTS penugasan_ruang (
  ujian_id  uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ruang_id  uuid NOT NULL REFERENCES ruang_ujian(id),
  PRIMARY KEY (ujian_id, user_id)
);
CREATE INDEX IF NOT EXISTS penugasan_ruang_ruang_idx ON penugasan_ruang (ruang_id, ujian_id);

-- Penugasan Pengawas ke ruang untuk satu ujian (tidak terikat Bidang Studi).
CREATE TABLE IF NOT EXISTS penugasan_pengawas (
  ujian_id    uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  ruang_id    uuid NOT NULL REFERENCES ruang_ujian(id),
  pengawas_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ujian_id, ruang_id, pengawas_id)
);

-- ============================================================
-- Soal
-- ============================================================
CREATE TABLE IF NOT EXISTS soal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode               text UNIQUE,
  bidang_studi_kode  text NOT NULL REFERENCES bidang_studi(kode),
  tipe               text NOT NULL CHECK (tipe IN ('PILIHAN_GANDA', 'ESAI')),
  isi                text NOT NULL,
  rubrik             text,                             -- wajib untuk ESAI (dipakai AI)
  skor_maks          integer,                          -- ESAI selalu 100; PILIHAN_GANDA null
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARSIP')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT soal_esai_wajib_rubrik
    CHECK (tipe <> 'ESAI' OR (rubrik IS NOT NULL AND skor_maks = 100)),
  CONSTRAINT soal_pg_tanpa_skor
    CHECK (tipe <> 'PILIHAN_GANDA' OR skor_maks IS NULL)
);
CREATE INDEX IF NOT EXISTS soal_bidang_tipe_idx ON soal (bidang_studi_kode, tipe, status);

CREATE TABLE IF NOT EXISTS soal_opsi (
  soal_id  uuid NOT NULL REFERENCES soal(id) ON DELETE CASCADE,
  label    text NOT NULL CHECK (label IN ('A', 'B', 'C', 'D', 'E')),
  teks     text NOT NULL,
  benar    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (soal_id, label)
);
-- Tepat satu opsi benar per soal pilihan ganda (diperiksa juga saat soal disimpan).
CREATE UNIQUE INDEX IF NOT EXISTS soal_opsi_satu_benar
  ON soal_opsi (soal_id) WHERE benar;

-- Soal dalam ujian. Tipe soal harus sesuai dengan bagian (dicek di server).
CREATE TABLE IF NOT EXISTS ujian_soal (
  ujian_id  uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  soal_id   uuid NOT NULL REFERENCES soal(id),
  urutan    integer NOT NULL CHECK (urutan > 0),
  PRIMARY KEY (ujian_id, soal_id),
  UNIQUE (ujian_id, urutan)
);

-- ============================================================
-- Pengerjaan
-- ============================================================
-- Satu pengerjaan per peserta per ujian (satu kali percobaan).
CREATE TABLE IF NOT EXISTS pengerjaan (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ujian_id                 uuid NOT NULL REFERENCES ujian(id),
  user_id                  uuid NOT NULL REFERENCES users(id),
  ruang_id                 uuid NOT NULL REFERENCES ruang_ujian(id),
  status                   text NOT NULL DEFAULT 'AKTIF' CHECK (status IN ('AKTIF', 'SELESAI', 'DIHENTIKAN')),
  dijeda_sejak             timestamptz,              -- terisi saat Pengawas menjeda
  dijeda_oleh              uuid REFERENCES users(id),
  total_jeda_detik         integer NOT NULL DEFAULT 0,
  pelanggaran_fokus        integer NOT NULL DEFAULT 0,
  skor_pilihan_ganda       integer,                  -- jumlah jawaban benar (dihitung saat bagian PG selesai)
  skor_esai                numeric(5,2),            -- 0–100, diisi setelah impor nilai esai
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ujian_id)
);
-- Peserta hanya boleh punya satu pengerjaan aktif dalam satu waktu.
CREATE UNIQUE INDEX IF NOT EXISTS pengerjaan_satu_aktif
  ON pengerjaan (user_id) WHERE status = 'AKTIF';
-- Indeks untuk dashboard monitoring per ruang.
CREATE INDEX IF NOT EXISTS pengerjaan_ruang_idx ON pengerjaan (ujian_id, ruang_id);

-- Status dan hitungan per bagian. Hitungan dipakai dashboard monitoring agar tidak perlu menghitung ulang.
CREATE TABLE IF NOT EXISTS pengerjaan_bagian (
  pengerjaan_id    uuid NOT NULL REFERENCES pengerjaan(id) ON DELETE CASCADE,
  tipe             text NOT NULL CHECK (tipe IN ('PILIHAN_GANDA', 'ESAI')),
  status           text NOT NULL DEFAULT 'BELUM_DIMULAI'
                   CHECK (status IN ('BELUM_DIMULAI', 'SEDANG_DIKERJAKAN', 'SELESAI')),
  mulai            timestamptz,
  batas            timestamptz,                      -- mulai + durasi + total jeda
  selesai          timestamptz,
  jumlah_tersimpan integer NOT NULL DEFAULT 0,
  revisi           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (pengerjaan_id, tipe)
);

-- Jawaban: satu baris per soal, diperbarui saat peserta pindah soal.
CREATE TABLE IF NOT EXISTS jawaban (
  pengerjaan_id  uuid NOT NULL REFERENCES pengerjaan(id) ON DELETE CASCADE,
  soal_id        uuid NOT NULL REFERENCES soal(id),
  tipe           text NOT NULL CHECK (tipe IN ('PILIHAN_GANDA', 'ESAI')),
  nilai          text NOT NULL CHECK (length(nilai) <= 10000),  -- huruf A–E, atau teks esai
  disimpan_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pengerjaan_id, soal_id)
);
CREATE INDEX IF NOT EXISTS jawaban_tipe_idx ON jawaban (pengerjaan_id, tipe);

-- ============================================================
-- Nilai esai (hasil impor dari AI)
-- ============================================================
CREATE TABLE IF NOT EXISTS impor_nilai (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama_file       text NOT NULL,
  hash_file       text NOT NULL,
  diimpor_oleh    uuid REFERENCES users(id),
  jumlah_baris    integer NOT NULL DEFAULT 0,
  jumlah_galat    integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nilai_esai (
  pengerjaan_id   uuid NOT NULL REFERENCES pengerjaan(id) ON DELETE CASCADE,
  soal_id         uuid NOT NULL REFERENCES soal(id),
  skor            numeric(5,2) NOT NULL CHECK (skor >= 0 AND skor <= 100),
  umpan_balik     text,
  sumber          text NOT NULL DEFAULT 'AI' CHECK (sumber IN ('AI', 'MANUAL')),
  impor_id        uuid REFERENCES impor_nilai(id),
  diperbarui_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pengerjaan_id, soal_id)
);

-- ============================================================
-- Log aktivitas (jeda, impor, perubahan penting)
-- ============================================================
CREATE TABLE IF NOT EXISTS log_aktivitas (
  id       bigserial PRIMARY KEY,
  waktu    timestamptz NOT NULL DEFAULT now(),
  pelaku   uuid REFERENCES users(id),
  aksi     text NOT NULL,
  target   text,
  detail   jsonb
);
CREATE INDEX IF NOT EXISTS log_waktu_idx ON log_aktivitas (waktu);

-- Keamanan: aplikasi mengakses database langsung lewat DATABASE_URL (pemilik tabel, melewati RLS).
-- Dengan RLS aktif tanpa policy, tabel ini TIDAK bisa dibaca/ditulis lewat Data API Supabase
-- (anon key atau pengguna Supabase Auth), sehingga tidak bocor jika URL API diketahui orang.
ALTER TABLE bidang_studi        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruang_ujian         ENABLE ROW LEVEL SECURITY;
ALTER TABLE seb_konfigurasi     ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ujian               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ujian_bagian        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ujian_seb           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ujian_ruang_token   ENABLE ROW LEVEL SECURITY;
ALTER TABLE penugasan_ruang     ENABLE ROW LEVEL SECURITY;
ALTER TABLE penugasan_pengawas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE soal                ENABLE ROW LEVEL SECURITY;
ALTER TABLE soal_opsi           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ujian_soal          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pengerjaan          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pengerjaan_bagian   ENABLE ROW LEVEL SECURITY;
ALTER TABLE jawaban             ENABLE ROW LEVEL SECURITY;
ALTER TABLE impor_nilai         ENABLE ROW LEVEL SECURITY;
ALTER TABLE nilai_esai          ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_aktivitas       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Berita acara (dikirim setelah ujian selesai, per ruang)
-- ============================================================
CREATE TABLE IF NOT EXISTS berita_acara (
  ujian_id     uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  ruang_id     uuid NOT NULL REFERENCES ruang_ujian(id),
  isi          jsonb NOT NULL,
  dikirim_at   timestamptz NOT NULL DEFAULT now(),
  dikirim_oleh uuid REFERENCES users(id),
  PRIMARY KEY (ujian_id, ruang_id)
);
ALTER TABLE berita_acara         ENABLE ROW LEVEL SECURITY;

COMMIT;
