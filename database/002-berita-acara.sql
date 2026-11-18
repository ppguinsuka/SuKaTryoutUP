-- SuKaTryoutUP: migrasi 002 (untuk database yang sudah berjalan dari 001).
-- Jalankan sekali di Supabase SQL Editor. Aman dijalankan ulang.
BEGIN;

-- Berita acara per ruang. Isi disimpan sebagai salinan (snapshot) saat dikirim,
-- sehingga tidak berubah meskipun data pengerjaan berubah setelahnya.
CREATE TABLE IF NOT EXISTS berita_acara (
  ujian_id     uuid NOT NULL REFERENCES ujian(id) ON DELETE CASCADE,
  ruang_id     uuid NOT NULL REFERENCES ruang_ujian(id),
  isi          jsonb NOT NULL,
  dikirim_at   timestamptz NOT NULL DEFAULT now(),
  dikirim_oleh uuid REFERENCES users(id),
  PRIMARY KEY (ujian_id, ruang_id)
);
ALTER TABLE berita_acara ENABLE ROW LEVEL SECURITY;

COMMIT;
