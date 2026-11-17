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

      <div className="page-bar">
        <h2>DAFTAR SESI UJIAN</h2>
        <button className="btn outline" onClick={logout}>Log Out</button>
      </div>

      <div className="container">
        <div className="info-box">
          <strong>Informasi</strong>
          <p>
            Berikut ini ditampilkan daftar sesi ujian untuk Anda. Perhatikan bahwa Anda <b>hanya boleh mengerjakan satu sesi ujian dalam waktu yang sama</b>.
            Ujian hanya dapat dibuka melalui <b>Safe Exam Browser (SEB)</b> di laptop.
          </p>
        </div>

        {error && <div className="error">{error}</div>}
        {!ujian && !error && <div>Memuat…</div>}
        {ujian && ujian.length === 0 && (
          <div className="info-box kosong">
            <strong>Perhatian!</strong>
            <p>Tidak ada sesi ujian yang dapat ditampilkan di sini. Silakan cek kembali dalam beberapa waktu ke depan, atau hubungi Panitia ujian Anda.</p>
          </div>
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

        <div className="sesi-grid">
          {ujian?.map((u) => (
            <div className="sesi-card" key={u.id}>
              <div className="sesi-judul">{u.judul}</div>
              <div className="sesi-kode">Kode: {u.kode}</div>

              {u.bagian.map((b) => (
                <dl className="sesi-bagian" key={b.tipe}>
                  <dt className="sesi-tipe">{LABEL[b.tipe]}</dt>
                  <dd><span>Mulai</span>{fmtWaktu(b.mulai)}</dd>
                  <dd><span>Durasi</span>{b.durasiMenit} menit</dd>
                  <dd><span>Batas</span>{fmtWaktu(b.selesai)}</dd>
                  <dd><span>Status</span>{b.status.replace(/_/g, ' ').toLowerCase()}</dd>
                </dl>
              ))}

              <div className="sesi-aksi">
                {u.pengerjaanStatus === 'SELESAI' ? (
                  <span className="sesi-n-a">Selesai</span>
                ) : (
                  <span className="sesi-n-a">N.A</span>
                )}
                {u.pengerjaanStatus === 'SELESAI' ? (
                  <div className="info-box kecil">Ujian ini sudah selesai dikerjakan. Hasil akan diumumkan oleh Panitia.</div>
                ) : u.pengerjaanId ? (
                  <Link className="btn hijau" href={`/peserta/kerjakan/${u.pengerjaanId}`}>Lanjutkan</Link>
                ) : (
                  <Link className="btn" href={`/peserta/ujian/${u.id}`}>mulai</Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
