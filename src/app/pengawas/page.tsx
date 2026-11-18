'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmtDetik, post } from '@/lib/client';

type UjianPengawas = { id: string; kode: string; judul: string; status: string; bidang_studi: string };
type Bagian = { tipe: 'PILIHAN_GANDA' | 'ESAI'; status: string; tersimpan: number; sisaDetik: number };
type Peserta = {
  userId: string;
  nama: string;
  username: string;
  bidangStudi: string;
  ruang: string;
  pengerjaanId: string | null;
  status: string;
  dijeda: boolean;
  pelanggaranFokus: number;
  bagian: Bagian[];
};
type Monitoring = { totalSoal: Record<string, number>; peserta: Peserta[] };

const NAMA_BAGIAN: Record<string, string> = { PILIHAN_GANDA: 'PG', ESAI: 'Esai' };
const NAMA_STATUS: Record<string, string> = {
  BELUM_MULAI: 'Belum mulai',
  AKTIF: 'Mengerjakan',
  SELESAI: 'Selesai',
  DIHENTIKAN: 'Dihentikan',
};

export default function PengawasPage() {
  const [daftar, setDaftar] = useState<UjianPengawas[] | null>(null);
  const [ujianId, setUjianId] = useState<string | null>(null);
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [terakhir, setTerakhir] = useState<string | null>(null);

  const muat = useCallback(async (id: string) => {
    try {
      const d = await api<Monitoring>(`/api/pengawas/monitoring?ujianId=${id}`);
      setData(d);
      setTerakhir(new Date().toLocaleTimeString('id-ID'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api<UjianPengawas[]>('/api/pengawas/ujian')
      .then((r) => {
        setDaftar(r);
        if (r.length === 1) setUjianId(r[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Pembaruan berkala: 15 detik (ringan untuk satu ruang).
  useEffect(() => {
    if (!ujianId) return;
    muat(ujianId);
    const t = setInterval(() => muat(ujianId), 15_000);
    return () => clearInterval(t);
  }, [ujianId, muat]);

  async function jeda(p: Peserta, aksi: 'jeda' | 'lanjut') {
    if (!p.pengerjaanId) return;
    setBusyId(p.pengerjaanId);
    try {
      await post(`/api/pengawas/pengerjaan/${p.pengerjaanId}/jeda`, { aksi });
      if (ujianId) await muat(ujianId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function logout() {
    await post('/api/auth/logout');
    window.location.href = '/login';
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/suka-sungai.png" alt="Logo SuKa Tryout" />
          <div>
            SuKa Tryout
            <div className="sub">Monitoring Pengawas</div>
          </div>
        </div>
        <button className="btn outline" onClick={logout}>Log Out</button>
      </div>

      <div className="container">
        {error && <div className="error">{error}</div>}

        {daftar && daftar.length === 0 && (
          <div className="card info">Anda belum ditugaskan mengawasi ujian apa pun.</div>
        )}

        {daftar && daftar.length > 1 && (
          <div className="card">
            <label style={{ fontSize: 14 }}>Pilih ujian: </label>
            <select value={ujianId ?? ''} onChange={(e) => setUjianId(e.target.value)} style={{ padding: 6 }}>
              <option value="">— pilih —</option>
              {daftar.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.judul} ({u.bidang_studi})
                </option>
              ))}
            </select>
          </div>
        )}

        {data && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 14 }}>
                Total soal: PG {data.totalSoal.PILIHAN_GANDA ?? 0}, Esai {data.totalSoal.ESAI ?? 0}
              </div>
              <div style={{ fontSize: 13, color: '#666' }}>Diperbarui {terakhir} (otomatis tiap 15 detik)</div>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table className="tabel">
                <thead>
                  <tr>
                    <th>Ruang</th>
                    <th>Nama</th>
                    <th>Bidang Studi</th>
                    <th>Status</th>
                    <th>PG (tersimpan / sisa)</th>
                    <th>Esai (tersimpan / sisa)</th>
                    <th>Pelanggaran fokus</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.peserta.map((p) => {
                    const pg = p.bagian.find((b) => b.tipe === 'PILIHAN_GANDA');
                    const es = p.bagian.find((b) => b.tipe === 'ESAI');
                    const status = p.dijeda ? 'Dijeda' : NAMA_STATUS[p.status] ?? p.status;
                    return (
                      <tr key={p.userId}>
                        <td>{p.ruang}</td>
                        <td>{p.nama}</td>
                        <td>{p.bidangStudi}</td>
                        <td>{status}</td>
                        <td>
                          {pg ? `${pg.tersimpan} / ${fmtDetik(pg.sisaDetik)}` : '—'}
                          {pg && <span style={{ fontSize: 11, color: '#666' }}> ({NAMA_BAGIAN.PILIHAN_GANDA})</span>}
                        </td>
                        <td>{es ? `${es.tersimpan} / ${fmtDetik(es.sisaDetik)}` : '—'}</td>
                        <td>{p.pelanggaranFokus}</td>
                        <td>
                          {p.pengerjaanId && p.status === 'AKTIF' ? (
                            p.dijeda ? (
                              <button className="btn hijau" disabled={busyId === p.pengerjaanId} onClick={() => jeda(p, 'lanjut')}>
                                Lanjutkan
                              </button>
                            ) : (
                              <button className="btn oranye" disabled={busyId === p.pengerjaanId} onClick={() => jeda(p, 'jeda')}>
                                Jeda
                              </button>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.peserta.length === 0 && (
                    <tr>
                      <td colSpan={8}>Belum ada peserta di ruang Anda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="info" style={{ marginTop: 10, fontSize: 13 }}>
              Kolom &quot;tersimpan&quot; menghitung jawaban yang sudah tersimpan di server, bukan jawaban yang sedang dipilih peserta.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
