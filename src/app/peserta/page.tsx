'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmtWaktu, post } from '@/lib/client';

type Bagian = { tipe: 'PILIHAN_GANDA' | 'ESAI'; durasiMenit: number; mulai: string; selesai: string; status: string };
type Ujian = {
  id: string;
  kode: string;
  judul: string;
  status: string;
  pengerjaanId: string | null;
  pengerjaanStatus: string | null;
  bagian: Bagian[];
};

const LABEL: Record<string, string> = {
  PILIHAN_GANDA: 'Pilihan Ganda',
  ESAI: 'Esai',
};

type Hasil = {
  judul: string;
  kode: string;
  skor_pilihan_ganda: number | null;
  skor_esai: string | null;
  total_pg: number;
  total_esai: number;
};

export default function PesertaDashboard() {
  const [ujian, setUjian] = useState<Ujian[] | null>(null);
  const [hasil, setHasil] = useState<Hasil[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Ujian[]>('/api/peserta/ujian')
      .then(setUjian)
      .catch((e: Error) => setError(e.message));
    api<Hasil[]>('/api/peserta/hasil').then(setHasil).catch(() => setHasil([]));
  }, []);

  async function logout() {
    await post('/api/auth/logout');
    window.location.href = '/login';
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/logo-uin.png" alt="Logo UIN Sunan Kalijaga Yogyakarta" />
          <div>
            SuKaTryoutUP
            <div className="sub">Daftar Sesi Ujian</div>
          </div>
        </div>
        <button className="btn outline" onClick={logout}>Log Out</button>
      </div>

      <div className="container">
        <div className="info" style={{ marginBottom: 14 }}>
          Anda hanya boleh mengerjakan satu ujian dalam waktu yang sama. Ujian dibuka sesuai jadwal yang ditetapkan Panitia.
          Ujian hanya dapat dibuka melalui <b>Safe Exam Browser (SEB)</b> di laptop.
        </div>

        {error && <div className="error">{error}</div>}
        {!ujian && !error && <div>Memuat…</div>}
        {ujian && ujian.length === 0 && (
          <div className="card info">Belum ada sesi ujian untuk Anda. Silakan cek kembali nanti atau hubungi Panitia.</div>
        )}

        {hasil.length > 0 && (
          <div className="card">
            <h3>Hasil Ujian</h3>
            <table className="tabel">
              <thead>
                <tr>
                  <th>Ujian</th>
                  <th>Pilihan Ganda</th>
                  <th>Esai (0–100)</th>
                </tr>
              </thead>
              <tbody>
                {hasil.map((h) => (
                  <tr key={h.kode}>
                    <td>{h.judul}</td>
                    <td>{h.skor_pilihan_ganda ?? '—'} / {h.total_pg} benar</td>
                    <td>{h.total_esai === 0 ? '—' : h.skor_esai ?? 'menunggu koreksi'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ujian?.map((u) => (
          <div className="card" key={u.id}>
            <h3>{u.judul}</h3>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>Kode: {u.kode}</div>
            <table className="tabel" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Bagian</th>
                  <th>Mulai</th>
                  <th>Batas</th>
                  <th>Durasi</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {u.bagian.map((b) => (
                  <tr key={b.tipe}>
                    <td>{LABEL[b.tipe]}</td>
                    <td>{fmtWaktu(b.mulai)}</td>
                    <td>{fmtWaktu(b.selesai)}</td>
                    <td>{b.durasiMenit} menit</td>
                    <td>{b.status.replace(/_/g, ' ').toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {u.pengerjaanStatus === 'SELESAI' ? (
              <div className="info">Ujian ini sudah selesai dikerjakan. Hasil akan diumumkan oleh Panitia.</div>
            ) : u.pengerjaanId ? (
              <Link className="btn hijau" href={`/peserta/kerjakan/${u.pengerjaanId}`}>Lanjutkan Ujian</Link>
            ) : (
              <Link className="btn" href={`/peserta/ujian/${u.id}`}>Buka Ujian</Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
