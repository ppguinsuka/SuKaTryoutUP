'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDetik, post } from '@/lib/client';
import { kontenKeHtml } from '@/lib/konten';

type Tipe = 'PILIHAN_GANDA' | 'ESAI';
type Bagian = { tipe: Tipe; status: string; jumlahTersimpan: number; sisaDetik: number };
type Nomor = { n: number; soalId: string; terjawab: boolean };
type Soal = { n: number; id: string; tipe: Tipe; isi: string; opsi: { label: string; teks: string }[] | null; nilai: string };
type View = {
  pengerjaan: { id: string; status: string };
  bagian: Bagian[];
  nomor: Nomor[];
  soal: Soal | null;
};

const MAKS_ESAI = 10000;
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
        setDraft(v.soal?.nilai ?? '');
        setSaved(v.soal?.nilai ?? '');
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

  /** Menyimpan jawaban hanya jika berubah. Dipanggil saat pindah soal, ganti bagian, dan selesai. */
  async function simpanJikaBerubah(): Promise<boolean> {
    const cur = latest.current;
    if (!cur.soalId || cur.draft === cur.saved) return true;
    try {
      await post(`/api/peserta/pengerjaan/${id}/aksi`, {
        aksi: 'simpan',
        tipe: cur.tipe,
        soalId: cur.soalId,
        nilai: cur.draft,
      });
      setSaved(cur.draft);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

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

  // Simpan otomatis esai setiap 60 detik (tanpa mengganggu pengetikan).
  useEffect(() => {
    const t = setInterval(() => {
      const cur = latest.current;
      if (cur.tipe !== 'ESAI' || !cur.soalId || cur.draft === cur.saved) return;
      post(`/api/peserta/pengerjaan/${cur.id}/aksi`, {
        aksi: 'simpan',
        tipe: 'ESAI',
        soalId: cur.soalId,
        nilai: cur.draft,
      })
        .then(() => setSaved(cur.draft))
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Jika halaman ditutup, kirim jawaban yang belum tersimpan dengan keepalive.
  useEffect(() => {
    const onHide = () => {
      const cur = latest.current;
      if (!cur.soalId || cur.draft === cur.saved) return;
      fetch(`/api/peserta/pengerjaan/${cur.id}/aksi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aksi: 'simpan', tipe: cur.tipe, soalId: cur.soalId, nilai: cur.draft }),
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
          <img src="/logo-uin.png" alt="Logo UIN Sunan Kalijaga Yogyakarta" />
          <div>
            SuKaTryoutUP
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
                  {belumTersimpan ? 'Belum tersimpan' : 'Tersimpan'}
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
                  onClick={() => {
                    setRagu((r) => {
                      const next = new Set(r);
                      if (next.has(soal.id)) next.delete(soal.id);
                      else next.add(soal.id);
                      return next;
                    });
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
