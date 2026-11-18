-- Jalankan SATU KALI sebelum deploy patch ini. Additive, tanpa menghapus jawaban.
BEGIN;
ALTER TABLE public.jawaban
  ADD COLUMN IF NOT EXISTS client_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.jawaban_ragu (
  pengerjaan_id uuid NOT NULL REFERENCES public.pengerjaan(id) ON DELETE CASCADE,
  soal_id uuid NOT NULL REFERENCES public.soal(id) ON DELETE CASCADE,
  ragu boolean NOT NULL DEFAULT true,
  diperbarui_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pengerjaan_id, soal_id)
);
-- Server memakai koneksi PG langsung, tidak ada akses langsung dari anon/authenticated.
ALTER TABLE public.jawaban_ragu ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jawaban_ragu FROM anon, authenticated;
ALTER TABLE public.pengerjaan ADD COLUMN IF NOT EXISTS fokus_terakhir timestamptz;
CREATE INDEX IF NOT EXISTS pengerjaan_fokus_idx ON public.pengerjaan(fokus_terakhir) WHERE status='AKTIF';
COMMIT;
