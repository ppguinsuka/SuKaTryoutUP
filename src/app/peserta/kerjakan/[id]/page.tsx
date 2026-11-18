'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDetik, post } from '@/lib/client';
import { kontenKeHtml } from '@/lib/konten';

type Tipe = 'PILIHAN_GANDA' | 'ESAI';
type Bagian = { tipe: Tipe; status: string; jumlahTersimpan: number; sisaDetik: number };
type Nomor = { n: number; soalId: string; terjawab: boolean; ragu?: boolean };
type Soal = { n: number; id: string; tipe: Tipe; isi: string; opsi: { label: string; teks: string }[] | null; nilai: string; versiServer?: number; disimpanAt?: string | null };
type View = {
  pengerjaan: { id: string; status: string };
  bagian: Bagian[];
  nomor: Nomor[];
  soal: Soal | null;
};

const MAKS_ESAI = 10000;
const DRAFT_MAX_AGE = 24 * 3600_000;
type CacheDraft = { nilai: string; versi: number; waktu: number };
const kunciDraft = (id: string, soalId: string) => `suka:jawaban:${id}:${soalId}`;
function bacaDraft(key: string): CacheDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as CacheDraft;
    if (!data || typeof data.nilai !== 'string' || Date.now() - data.waktu > DRAFT_MAX_AGE) {
      localStorage.removeItem(key); return null;
    }
    return data;
  } catch { return null; }
}
function simpanDraft(key: string, entry: CacheDraft) {
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* private mode/quota */ }
}

const NAMA: Record<Tipe, string> = { PILIHAN_GANDA: 'Pilihan Ganda', ESAI: 'Esai' };

export default function KerjakanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [tipe, setTipe] = useState<Tipe>('PILIHAN_GANDA');
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');
  const [ragu, setRagu] = useState<Set<string>>(new Set());
  const [sisa, setSisa] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const antreanRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastRevisionRef = useRef(0);

  const bagianAktif = view?.bagian.find((b) => b.tipe === tipe);
  const pgSelesai = view?.bagian.find((b) => b.tipe === 'PILIHAN_GANDA')?.status === 'SELESAI';
  const nomorAktif = view?.soal?.n ?? 1;
  const belumTersimpan = !!view?.soal && draft !== saved;

  // Nilai terbaru untuk handler yang berjalan saat halaman ditutup atau timer esai.
  const latest = useRef({ draft, saved, soalId: null as string | null, tipe, id });
  latest.current = { draft, saved, soalId: view?.soal?.id ?? null, tipe, id };

  const load = useCallback(
    async (t: Tipe, n: number) => {
      try {
        const v = await api<View>(`/api/peserta/pengerjaan/${id}?tipe=${t}&n=${n}`);
        setView(v);
        const soal = v.soal;
        const key = soal ? kunciDraft(id, soal.id) : '';
        const local = soal ? bacaDraft(key) : null;
        const revisionServer = soal?.versiServer ?? 0;
        const pakaiCache = !!local && local.versi > revisionServer;
        setDraft(pakaiCache ? local!.nilai : soal?.nilai ?? '');
        setSaved(soal?.nilai ?? '');
        if (local && !pakaiCache) localStorage.removeItem(key);
        lastRevisionRef.current = Math.max(lastRevisionRef.current, revisionServer, local?.versi ?? 0);
        setRagu(new Set(v.nomor.filter((x) => x.ragu).map((x) => x.soalId)));
        setSisa(v.bagian.find((b) => b.tipe === t)?.sisaDetik ?? null);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [id],
  );

  useEffect(() => {
    load('PILIHAN_GANDA', 1);
  }, [load]);

  /** Simpan berurutan, persisten lokal sampai ACK server, tidak tertimpa request lama. */
  const simpanJikaBerubah = useCallback(async (): Promise<boolean> => {
    const cur = { ...latest.current };
    if (!cur.soalId || cur.draft === cur.saved) return antreanRef.current;
    const key = kunciDraft(id, cur.soalId);
    const pending = bacaDraft(key);
    const versi = pending?.nilai === cur.draft
      ? pending.versi
      : Math.max(Date.now(), lastRevisionRef.current + 1);
    lastRevisionRef.current = Math.max(lastRevisionRef.current, versi);
    simpanDraft(key, { nilai: cur.draft, versi, waktu: Date.now() });
    const lakukan = async () => {
      setSaving(true);
      try {
        const hasil = await post<{ versiServer: number; tersimpan: boolean }>(
          `/api/peserta/pengerjaan/${id}/aksi`,
          { aksi: 'simpan', tipe: cur.tipe, soalId: cur.soalId, nilai: cur.draft, versi }
        );
        if (!hasil.tersimpan || Number(hasil.versiServer) < versi) {
          // Server sudah memiliki revisi lebih baru. Jangan menimpa.
          await load(cur.tipe, view?.soal?.n ?? 1);
          return true;
        }
        if (bacaDraft(key)?.versi === versi) localStorage.removeItem(key);
        if (latest.current.soalId === cur.soalId && latest.current.draft === cur.draft) {
          setSaved(cur.draft);
        }
        setError(null);
        return true;
      } catch (e) {
        setError(`Jawaban belum tersimpan di server. Draft disimpan di perangkat ini. ${(e as Error).message}`);
        return false;
      } finally { setSaving(false); }
    };
    antreanRef.current = antreanRef.current.catch(() => false).then(lakukan);
    return antreanRef.current;
  }, [id, load, view?.soal?.n]);

  // Draft ditulis segera ke perangkat, lalu autosave PG cepat / esai setelah berhenti mengetik.
  useEffect(() => {
    const cur = latest.current;
    if (!cur.soalId || cur.draft === cur.saved || bagianAktif?.status !== 'SEDANG_DIKERJAKAN') return;
    const key = kunciDraft(id, cur.soalId);
    const before = bacaDraft(key);
    const versi = before?.nilai === cur.draft
      ? before.versi : Math.max(Date.now(), lastRevisionRef.current + 1);
    lastRevisionRef.current = Math.max(versi, lastRevisionRef.current);
    simpanDraft(key, { nilai: cur.draft, versi, waktu: Date.now() });
    const t = setTimeout(() => { void simpanJikaBerubah(); }, cur.tipe === 'ESAI' ? 1800 : 350);
    return () => clearTimeout(t);
  }, [draft, saved, id, tipe, view?.soal?.id, bagianAktif?.status, simpanJikaBerubah]);

  async function pindahSoal(n: number) {
    if (busy || !view?.soal) return;
    setBusy(true);
    setInfo(null);
    if (await simpanJikaBerubah()) await load(tipe, n);
    setBusy(false);
  }

  async function pindahBagian(t: Tipe) {
    if (busy) return;
    if (t === 'ESAI' && !pgSelesai) return;
    setBusy(true);
    if (await simpanJikaBerubah()) {
      setTipe(t);
      await load(t, 1);
    }
    setBusy(false);
  }

  async function mulaiBagian() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/peserta/pengerjaan/${id}/aksi`, { aksi: 'mulai', tipe });
      await load(tipe, 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function selesaiBagian() {
    if (!window.confirm(`Akhiri bagian ${NAMA[tipe]}? Jawaban tidak dapat diubah setelah diakhiri.`)) return;
    setBusy(true);
    if (await simpanJikaBerubah()) {
      try {
        await post(`/api/peserta/pengerjaan/${id}/aksi`, { aksi: 'selesai', tipe });
        setInfo(`Bagian ${NAMA[tipe]} telah selesai.`);
        await load(tipe, 1);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setBusy(false);
  }

  // Hitung mundur di sisi klien. Sumber kebenaran tetap server (dikirim ulang saat load).
  useEffect(() => {
    if (sisa === null) return;
    if (sisa <= 0) {
      if (bagianAktif?.status === 'SEDANG_DIKERJAKAN') {
        const t = setTimeout(() => load(tipe, nomorAktif), 1500);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => setSisa((s) => (s ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [sisa, tipe, nomorAktif, bagianAktif?.status, load]);

  // Retry ketika koneksi kembali; pemeriksaan periodik hanya untuk draft yang gagal.
  useEffect(() => {
    const retry = () => { if (latest.current.draft !== latest.current.saved) void simpanJikaBerubah(); };
    window.addEventListener('online', retry);
    const interval = window.setInterval(retry, 20_000);
    return () => { window.removeEventListener('online', retry); clearInterval(interval); };
  }, [simpanJikaBerubah]);

  // Catat indikasi perpindahan tab untuk pengawas. Bukan penentu otomatis kecurangan.
  useEffect(() => {
    const lapor = () => {
      if (!document.hidden || latest.current.soalId === null) return;
      void post(`/api/peserta/pengerjaan/${id}/aksi`, { aksi: 'fokus' }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', lapor);
    return () => document.removeEventListener('visibilitychange', lapor);
  }, [id]);

  // Jika halaman ditutup, kirim jawaban yang belum tersimpan dengan keepalive.
  useEffect(() => {
    const onHide = () => {
      const cur = latest.current;
      if (!cur.soalId || cur.draft === cur.saved) return;
      fetch(`/api/peserta/pengerjaan/${cur.id}/aksi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'simpan', tipe: cur.tipe, soalId: cur.soalId, nilai: cur.draft, versi: bacaDraft(kunciDraft(id,cur.soalId))?.versi ?? Date.now() }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const soal = view?.soal;
  const soalSaatIni = soal ? ragu.has(soal.id) : false;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/suka-sungai.png" alt="Logo SuKa Tryout" />
          <div>
            SuKa Tryout
            <div className="sub">Pengerjaan Ujian</div>
          </div>
        </div>
        {bagianAktif && bagianAktif.status === 'SEDANG_DIKERJAKAN' && sisa !== null ? (
          <div className={`timer ${sisa < 300 ? 'kritis' : ''}`} aria-label="Sisa waktu">
            {fmtDetik(Math.max(0, sisa))}
          </div>
        ) : null}
      </div>

      <div className="container">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['PILIHAN_GANDA', 'ESAI'] as Tipe[]).map((t) => {
            const disabled = t === 'ESAI' && !pgSelesai;
            return (
              <button
                key={t}
                className={`btn ${tipe === t ? '' : 'outline'}`}
                disabled={disabled || busy}
                title={disabled ? 'Selesaikan bagian pilihan ganda terlebih dahulu' : ''}
                onClick={() => pindahBagian(t)}
              >
                {NAMA[t]}
              </button>
            );
          })}
          <Link className="btn outline" href="/peserta" style={{ marginLeft: 'auto' }}>
            Kembali ke Dashboard
          </Link>
        </div>

        {info && <div className="info" style={{ marginBottom: 10 }}>{info}</div>}
        {error && <div className="error">{error}</div>}

        {!view && !error && <div>Memuat…</div>}

        {view && !soal && (
          <div className="card">
            {bagianAktif?.status === 'SELESAI' ? (
              <div className="info">Bagian {NAMA[tipe]} sudah selesai. Anda tidak dapat mengubah jawaban lagi.</div>
            ) : (
              <>
                <h3>Bagian {NAMA[tipe]}</h3>
                <p style={{ fontSize: 14 }}>
                  Setelah Anda menekan tombol mulai, waktu bagian ini berjalan dan tidak dapat dihentikan.
                </p>
                <button className="btn hijau" disabled={busy} onClick={mulaiBagian}>
                  Mulai {NAMA[tipe]}
                </button>
              </>
            )}
          </div>
        )}

        {view && soal && (
          <div className="layout-ujian">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <b>Soal No {soal.n}</b>
                <span style={{ fontSize: 13, color: belumTersimpan ? '#b26a00' : '#666' }}>
                  {saving ? 'Menyimpan…' : belumTersimpan ? 'Draft belum tersinkron' : 'Tersimpan di server'}
                </span>
              </div>
              <div className="soal-html" style={{ lineHeight: 1.6, marginBottom: 14 }} dangerouslySetInnerHTML={{ __html: kontenKeHtml(soal.isi) }} />

              {soal.tipe === 'PILIHAN_GANDA' && soal.opsi && (
                <div>
                  <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>Pilih salah satu jawaban</div>
                  {soal.opsi.map((o) => (
                    <div
                      key={o.label}
                      className={`opsi ${draft === o.label ? 'dipilih' : ''}`}
                      onClick={() => setDraft((d) => (d === o.label ? '' : o.label))}
                      role="radio"
                      aria-checked={draft === o.label}
                    >
                      <span className="huruf">{o.label}</span>
                      <div className="soal-html" dangerouslySetInnerHTML={{ __html: kontenKeHtml(o.teks) }} />
                    </div>
                  ))}
                </div>
              )}

              {soal.tipe === 'ESAI' && (
                <div>
                  <textarea
                    className="esai"
                    value={draft}
                    maxLength={MAKS_ESAI}
                    placeholder="Tulis jawaban Anda di sini"
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => e.preventDefault()}
                    onCopy={(e) => e.preventDefault()}
                    onCut={(e) => e.preventDefault()}
                    onDrop={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                  <div style={{ fontSize: 12, color: '#666', textAlign: 'right' }}>
                    {draft.length} / {MAKS_ESAI} karakter. Salin-tempel dinonaktifkan.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
                <button className="btn outline" disabled={busy || soal.n <= 1} onClick={() => pindahSoal(soal.n - 1)}>
                  Sebelumnya
                </button>
                <button
                  className="btn oranye"
                  onClick={async () => {
                    const nextValue = !ragu.has(soal.id);
                    setRagu((prev) => { const next = new Set(prev); if (nextValue) next.add(soal.id); else next.delete(soal.id); return next; });
                    try {
                      await post(`/api/peserta/pengerjaan/${id}/aksi`, { aksi: 'ragu', tipe, soalId: soal.id, ragu: nextValue });
                    } catch (e) {
                      setRagu((prev) => { const next = new Set(prev); if (nextValue) next.delete(soal.id); else next.add(soal.id); return next; });
                      setError((e as Error).message);
                    }
                  }}
                >
                  {soalSaatIni ? 'Batal Ragu' : 'Tandai Ragu'}
                </button>
                <button
                  className="btn"
                  disabled={busy || soal.n >= (view.nomor.length || 1)}
                  onClick={() => pindahSoal(soal.n + 1)}
                >
                  Selanjutnya
                </button>
              </div>
            </div>

            <div>
              <div className="card">
                <h3 style={{ fontSize: 15 }}>Nomor Soal</h3>
                <div className="grid-nomor">
                  {view.nomor.map((x) => {
                    const cls = [
                      'nomor',
                      x.n === soal.n ? 'aktif' : '',
                      ragu.has(x.soalId) ? 'ragu' : x.terjawab ? 'terjawab' : '',
                    ].join(' ');
                    return (
                      <button key={x.soalId} className={cls} onClick={() => pindahSoal(x.n)} disabled={busy}>
                        {String(x.n).padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
                <div className="legenda">
                  <span className="l-aktif">Sedang dibuka</span>
                  <span className="l-terjawab">Tersimpan</span>
                  <span className="l-kosong">Belum dijawab</span>
                  <span style={{ color: '#b26a00' }}>● Ragu-ragu</span>
                </div>
              </div>

              <div className="card">
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  Tersimpan: {bagianAktif?.jumlahTersimpan ?? 0} dari {view.nomor.length} soal
                </div>
                <button className="btn merah" style={{ width: '100%' }} disabled={busy} onClick={selesaiBagian}>
                  Selesai {NAMA[tipe]}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
