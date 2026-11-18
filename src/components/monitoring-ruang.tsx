'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDetik, post } from '@/lib/client';

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

const NAMA_STATUS: Record<string, string> = {
  BELUM_MULAI: 'Belum mulai',
  AKTIF: 'Mengerjakan',
  SELESAI: 'Selesai',
  DIHENTIKAN: 'Dihentikan',
};

/**
 * Tabel peserta satu ruang (tampilan sama dengan dashboard pengawas).
 * Dipakai Super Admin untuk memantau ruang mana pun pada ujian yang dipilih.
 */
export function MonitoringRuangTable({ ujianId, ruangId, onError }: { ujianId: string; ruangId: string; onError: (m: string | null) => void }) {
  const [data, setData] = useState<Monitoring | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Simpan callback di ref agar muat() tetap stabil dan polling tidak berulang tanpa henti.
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const muat = useCallback(async () => {
    try {
      const d = await api<Monitoring>(`/api/pengawas/monitoring?ujianId=${ujianId}&ruangId=${ruangId}`);
      setData(d);
      errorRef.current(null);
    } catch (e) {
      errorRef.current((e as Error).message);
    }
  }, [ujianId, ruangId]);

  useEffect(() => {
    setData(null);
    muat();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void muat(); }, 20_000);
    return () => clearInterval(t);
  }, [muat]);

  async function jeda(p: Peserta, aksi: 'jeda' | 'lanjut') {
    if (!p.pengerjaanId) return;
    setBusyId(p.pengerjaanId);
    try {
      await post(`/api/pengawas/pengerjaan/${p.pengerjaanId}/jeda`, { aksi });
      await muat();
    } catch (e) {
      errorRef.current((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return <div>Memuat peserta…</div>;

  const totalPg = data.totalSoal.PILIHAN_GANDA ?? 0;
  const totalEsai = data.totalSoal.ESAI ?? 0;

  return (
    <>
      <div className="notice neutral" style={{ fontSize: 13 }}>
        Soal: {totalPg} pilihan ganda dan {totalEsai} esai. Kolom &quot;tersimpan&quot; menghitung jawaban yang sudah tersimpan di server.
      </div>
      <table className="tabel">
        <thead>
          <tr>
            <th>Ruang</th>
            <th>Nama</th>
            <th>Bidang Studi</th>
            <th>Status</th>
            <th>PG (tersimpan / sisa)</th>
            <th>Esai (tersimpan / sisa)</th>
            <th>Indikasi perpindahan tab</th>
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
                <td>{pg ? `${pg.tersimpan} / ${fmtDetik(pg.sisaDetik)}` : '—'}</td>
                <td>{es ? `${es.tersimpan} / ${fmtDetik(es.sisaDetik)}` : '—'}</td>
                <td>{p.pelanggaranFokus}</td>
                <td>
                  {p.pengerjaanId && p.status === 'AKTIF' ? (
                    p.dijeda ? (
                      <button className="btn hijau" disabled={busyId === p.pengerjaanId} onClick={() => jeda(p, 'lanjut')}>Lanjutkan</button>
                    ) : (
                      <button className="btn oranye" disabled={busyId === p.pengerjaanId} onClick={() => jeda(p, 'jeda')}>Jeda</button>
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
              <td colSpan={8}>Belum ada peserta di ruang ini.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
