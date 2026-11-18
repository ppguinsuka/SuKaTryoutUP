-- Opsional: jalankan manual saat ujian TIDAK berlangsung, tidak menghapus data peserta.
BEGIN;
DELETE FROM public.sessions WHERE expires_at < now() - interval '7 days';
DELETE FROM public.login_limits WHERE window_start < now() - interval '7 days';
COMMIT;
