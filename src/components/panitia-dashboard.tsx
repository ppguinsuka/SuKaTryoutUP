'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, ClipboardList, FileQuestion, MonitorCheck, Plus, RefreshCw, Users, DoorOpen, CheckCircle2, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/client';

export type DashboardSection = 'ujian' | 'soal' | 'peserta' | 'pengawas' | 'ruang' | 'nilai';
type Stats = { peserta: number; pengawas: number; ruang: number; soal: number; ujian: number; ujian_aktif: number; sedang_mengerjakan: number; selesai: number };
type UjianTerbaru = { id: string; kode: string; judul: string; status: string; bidang: string; sudah_mulai: number };
type DashboardResponse = { stats: Stats; terbaru: UjianTerbaru[] };
type Card = { label: string; field: keyof Stats; foot: string; icon: LucideIcon; tone: string };
const cards: Card[] = [
  { label: 'Ujian aktif', field: 'ujian_aktif', foot: 'Ujian berstatus aktif', icon: ClipboardList, tone: 'blue' },
  { label: 'Peserta aktif', field: 'peserta', foot: 'Akun peserta tersedia', icon: Users, tone: 'teal' },
  { label: 'Sedang ujian', field: 'sedang_mengerjakan', foot: 'Pengerjaan berlangsung', icon: MonitorCheck, tone: 'amber' },
  { label: 'Selesai ujian', field: 'selesai', foot: 'Pengerjaan selesai', icon: CheckCircle2, tone: 'green' },
];
const actions: { tab: DashboardSection; label: string; detail: string; icon: LucideIcon; tone: string }[] = [
  { tab: 'ujian', label: 'Kelola Ujian', detail: 'Jadwal, token, soal, dan penugasan', icon: ClipboardList, tone: 'blue' },
  { tab: 'soal', label: 'Bank Soal', detail: 'Pilihan ganda, esai, dan rubrik', icon: FileQuestion, tone: 'teal' },
  { tab: 'peserta', label: 'Data Peserta', detail: 'Akun dan impor CSV peserta', icon: Users, tone: 'blue' },
  { tab: 'pengawas', label: 'Pengawas', detail: 'Kelola petugas pengawasan', icon: MonitorCheck, tone: 'amber' },
  { tab: 'ruang', label: 'Ruang Ujian', detail: 'Kapasitas dan pembagian ruang', icon: DoorOpen, tone: 'teal' },
  { tab: 'nilai', label: 'Nilai & Hasil', detail: 'Impor nilai esai dan publikasi', icon: BookOpen, tone: 'green' },
];

export function PanitiaDashboard({ onNavigate }: { onNavigate: (tab: DashboardSection) => void }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let active = true;
    api<DashboardResponse>('/api/panitia?aksi=dashboard')
      .then((result) => { if (active) { setData(result); setError(null); } })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refreshKey]);
  return <div className="panitia-dashboard">
    <header className="page-header">
      <div><span className="eyebrow">OVERVIEW</span><h1>Dashboard Panitia</h1><p>Pantau ujian, peserta, pengawasan, dan progres pengerjaan dalam satu halaman.</p></div>
      <div className="action-row">
        <button type="button" className="button secondary" onClick={() => { setData(null); setError(null); setRefreshKey((v) => v + 1); }}><RefreshCw size={17}/> Perbarui</button>
        <button type="button" className="button primary" onClick={() => onNavigate('ujian')}><Plus size={17}/> Kelola Ujian</button>
      </div>
    </header>
    {error && <div className="notice danger" role="alert">{error} <button className="text-button" onClick={() => setRefreshKey((v) => v + 1)}>Coba lagi</button></div>}
    <div className="admin-stat-grid">
      {cards.map(({ label, field, foot, icon: Icon, tone }) => <article key={field}>
        <span className={`stat-icon ${tone}`}><Icon size={23}/></span><div>
          <small>{label}</small><strong>{data ? data.stats[field].toLocaleString('id-ID') : '—'}</strong><span>{foot}</span>
        </div>
      </article>)}
    </div>
    <div className="admin-two-column">
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">UJIAN</span><h2>Ujian Terbaru</h2></div><button className="text-button" type="button" onClick={() => onNavigate('ujian')}>Lihat semua <ArrowRight size={16}/></button></div>
        <div className="table-wrap"><table><thead><tr><th>Ujian</th><th>Bidang Studi</th><th>Status</th><th>Peserta mulai</th></tr></thead><tbody>
          {data && data.terbaru.length === 0 && <tr><td colSpan={4} className="dashboard-empty">Belum ada ujian. Mulai dengan membuat ujian baru.</td></tr>}
          {data?.terbaru.map((ujian) => <tr key={ujian.id}><td><strong>{ujian.judul}</strong><small>{ujian.kode}</small></td><td>{ujian.bidang}</td><td><span className={`status-dot ${ujian.status === 'AKTIF' ? 'active' : ujian.status === 'DRAFT' ? 'draft' : ujian.status === 'DIPUBLIKASIKAN' ? 'submitted' : ''}`}>{ujian.status.replaceAll('_', ' ')}</span></td><td>{ujian.sudah_mulai}</td></tr>)}
          {!data && !error && <tr><td colSpan={4} className="dashboard-empty">Memuat data terbaru…</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel quick-panel">
        <div className="panel-heading"><div><span className="eyebrow">AKSI CEPAT</span><h2>Kelola Sistem Tryout</h2></div></div>
        {actions.map(({ tab, label, detail, icon: Icon, tone }) => <button key={tab} type="button" className="quick-action" onClick={() => onNavigate(tab)}>
          <span className={`mini-icon ${tone}`}><Icon size={21}/></span><span className="quick-action-content"><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17}/>
        </button>)}
      </section>
    </div>
    {data && <div className="overview-bottom"><span>Total: <b>{data.stats.ujian}</b> ujian</span><span><b>{data.stats.soal}</b> soal</span><span><b>{data.stats.pengawas}</b> pengawas</span><span><b>{data.stats.ruang}</b> ruang</span></div>}
  </div>;
}
