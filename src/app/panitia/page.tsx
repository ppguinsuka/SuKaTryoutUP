'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, fmtDetik, fmtWaktu, post } from '@/lib/client';
import { AdminShell } from '@/components/admin-shell';
import { PanitiaDashboard } from '@/components/panitia-dashboard';
import { RichEditor } from '@/components/rich-editor';
import { MonitoringRuangTable } from '@/components/monitoring-ruang';
import { teksPolos } from '@/lib/konten';
import '../admin-theme.css';

/** Membaca berkas sebagai base64 (tanpa prefix data URL) agar bisa dikirim sebagai JSON. */
function fileKeBase64(file: File): Promise<string> {
  if (file.size > 2_500_000) return Promise.reject(new Error('Berkas maksimal 2,5 MB. Bagi data menjadi beberapa berkas.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
    reader.readAsDataURL(file);
  });
}

type Tab = 'dashboard' | 'ujian' | 'soal' | 'peserta' | 'pengawas' | 'ruang' | 'nilai' | 'berita' | 'log' | 'monitoring';
type Bidang = { kode: string; nama: string };
type Ruang = { id: string; kode: string; nama: string; kapasitas: number };
type Seb = { id: string; nama: string; platform: string; aktif: boolean; jumlah_ujian: number };
type Pengawas = { id: string; nama: string; username: string };
type Rujukan = { bidang: Bidang[]; ruang: Ruang[]; seb: Seb[]; pengawas: Pengawas[] };

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ujian', label: 'Ujian' },
  { id: 'soal', label: 'Soal' },
  { id: 'peserta', label: 'Peserta' },
  { id: 'pengawas', label: 'Pengawas' },
  { id: 'ruang', label: 'Ruang' },
  { id: 'nilai', label: 'Nilai Esai & Hasil' },
  { id: 'berita', label: 'Berita Acara' },
  { id: 'log', label: 'Log Aktivitas' },
];

async function aksi<T = unknown>(body: Record<string, unknown>) {
  return post<T>('/api/panitia', body);
}
async function baca<T>(query: string) {
  return api<T>(`/api/panitia?${query}`);
}

/** ISO → nilai untuk input datetime-local (zona waktu lokal). */
function keInputLokal(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function PanitiaPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [rujukan, setRujukan] = useState<Rujukan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namaPengguna, setNamaPengguna] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const muatRujukan = useCallback(() => {
    baca<Rujukan>('aksi=rujukan')
      .then(setRujukan)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    muatRujukan();
    api<{ nama: string } | null>('/api/auth/me').then((u) => setNamaPengguna(u?.nama ?? '')).catch(() => undefined);
  }, [muatRujukan]);

  async function logout() {
    await post('/api/auth/logout');
    window.location.href = '/login';
  }

  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    api<{ role: string } | null>('/api/auth/me').then((d) => setRole(d?.role ?? null)).catch(() => setRole(null));
  }, []);
  const tabNav: { id: Tab; label: string }[] = role === 'SUPER_ADMIN' ? [...TABS, { id: 'monitoring', label: 'Monitoring' }] : TABS;

  function pilihTab(id: Tab) {
    setTab(id);
    setError(null);
    setInfo(null);
  }

  const judulTab = tabNav.find((t) => t.id === tab)?.label ?? '';

  return (
    <AdminShell
      title="SuKa Tryout"
      subtitle="Panel Panitia"
      userName={namaPengguna || undefined}
      nav={tabNav}
      active={tab}
      onSelect={pilihTab}
      onLogout={logout}
    >
      {tab !== 'dashboard' && <div className="page-header">
        <div><span className="eyebrow">MANAJEMEN TRYOUT</span><h1>{judulTab}</h1><p>Kelola {judulTab.toLowerCase()} sesuai kebutuhan penyelenggaraan tryout.</p></div>
      </div>}

      {error && <div className="notice danger">{error}</div>}
      {info && <div className="notice neutral">{info}</div>}

      {tab === 'dashboard' && <PanitiaDashboard onNavigate={pilihTab} />}
      {tab === 'monitoring' && role === 'SUPER_ADMIN' && <MonitoringTab setError={setError} />}
      {!rujukan && !error && tab !== 'dashboard' && <div>Memuat…</div>}
      {rujukan && tab === 'ujian' && <UjianTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'soal' && <SoalTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'peserta' && <PesertaTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'pengawas' && <PengawasTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'ruang' && <RuangTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'nilai' && <NilaiTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'berita' && <BeritaTab setError={setError} setInfo={setInfo} />}
      {tab === 'log' && <LogTab setError={setError} />}
    </AdminShell>
  );
}

type Props = {
  rujukan: Rujukan;
  setError: (s: string | null) => void;
  setInfo: (s: string | null) => void;
};

/* ------------------------------------------------------------------ *
 * Ruang
 * ------------------------------------------------------------------ */
function RuangTab({ rujukan, onRefresh, setError, setInfo }: Props & { onRefresh: () => void }) {
  async function imporBerkas(file: File): Promise<boolean> {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-ruang', berkas: await fileKeBase64(file), namaFile: file.name });
      setInfo(`${r.jumlah} ruang berhasil diimpor.`);
      onRefresh();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  const [form, setForm] = useState({ id: '', kode: '', nama: '', kapasitas: '30' });

  async function simpan() {
    setError(null);
    try {
      await aksi({ aksi: 'simpan-ruang', data: { ...form, kapasitas: Number(form.kapasitas) } });
      setInfo('Ruang disimpan.');
      setForm({ id: '', kode: '', nama: '', kapasitas: '30' });
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <h3>Daftar Ruang</h3>
        <table className="tabel">
          <thead><tr><th>Kode</th><th>Nama</th><th>Kapasitas</th><th></th></tr></thead>
          <tbody>
            {rujukan.ruang.map((r) => (
              <tr key={r.id}>
                <td>{r.kode}</td><td>{r.nama}</td><td>{r.kapasitas}</td>
                <td><button className="btn outline" onClick={() => setForm({ id: r.id, kode: r.kode, nama: r.nama, kapasitas: String(r.kapasitas) })}>Ubah</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>{form.id ? 'Ubah Ruang' : 'Tambah Ruang'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <input placeholder="Kode" value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} />
          <input placeholder="Nama ruang" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          <input type="number" min={1} placeholder="Kapasitas" value={form.kapasitas} onChange={(e) => setForm({ ...form, kapasitas: e.target.value })} />
        </div>
        <div style={{ marginTop: 10 }}><button className="btn" onClick={simpan}>Simpan</button></div>
      </div>
      <div className="card">
        <ImporBox
          judul="Impor Ruang (Excel)"
          petunjuk={[
            <>Unduh template, lalu isi kolom <code>kode</code>, <code>nama</code>, dan <code>kapasitas</code>.</>,
            <><code>kode</code> harus unik. Jika sudah ada, nama dan kapasitasnya diperbarui.</>,
            <><code>kapasitas</code> berupa angka bulat minimal 1.</>,
          ]}
          templateHref="/api/panitia?aksi=template-ruang"
          onImport={imporBerkas}
        />
      </div>
    </>
  );
}

/** Kotak impor seragam: petunjuk bernomor, unduh template, pilih berkas, lalu impor. */
function ImporBox({
  judul,
  pengantar,
  petunjuk,
  templateHref,
  onImport,
}: {
  judul: string;
  pengantar?: string;
  petunjuk: ReactNode[];
  templateHref: string;
  onImport: (berkas: File) => Promise<boolean>;
}) {
  const [berkas, setBerkas] = useState<File | null>(null);
  const [kunci, setKunci] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pratinjau, setPratinjau] = useState<{baris:number;kolom:string[];kurang:string[];duplikat:number;kosong:number;contoh:string[][]}|null>(null);
  const [errorPreview, setErrorPreview] = useState<string|null>(null);
  const jenis = judul.toLowerCase().includes('soal') ? 'soal' : judul.toLowerCase().includes('peserta') ? 'peserta'
    : judul.toLowerCase().includes('pengawas') ? 'pengawas' : judul.toLowerCase().includes('ruang') ? 'ruang' : 'esai';
  async function periksa() {
    if (!berkas) return;
    setBusy(true); setErrorPreview(null); setPratinjau(null);
    try {
      const r=await aksi<typeof pratinjau>({aksi:'pratinjau-impor',jenis,berkas:await fileKeBase64(berkas),namaFile:berkas.name});
      setPratinjau(r);
    } catch(e) {setErrorPreview((e as Error).message);} finally {setBusy(false);}
  }

  async function jalankan() {
    if (!berkas) return;
    setBusy(true);
    const ok = await onImport(berkas);
    setBusy(false);
    if (ok) {
      setBerkas(null);
      setPratinjau(null);
      setKunci((k) => k + 1);
    }
  }

  return (
    <div className="import-box">
      <h4>{judul}</h4>
      {pengantar && <p className="import-intro">{pengantar}</p>}
      <ol>
        {petunjuk.map((p, i) => <li key={i}>{p}</li>)}
      </ol>
      <div className="import-actions">
        <a className="btn outline" href={templateHref}>Unduh Template Excel</a>
        <input key={kunci} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => {setBerkas(e.target.files?.[0] ?? null);setPratinjau(null);setErrorPreview(null);}} />
        <button className="btn outline" disabled={!berkas || busy} onClick={periksa}>{busy ? 'Memeriksa…' : '2. Periksa berkas'}</button>
        <button className="btn" disabled={!berkas || busy || !pratinjau || pratinjau.kurang.length>0 || pratinjau.duplikat>0} onClick={jalankan}>
          {busy ? 'Mengimpor…' : '3. Konfirmasi impor'}
        </button>
      </div>
      {errorPreview && <div className="notice danger">{errorPreview}</div>}
      {pratinjau && <div className="import-preview-box">
        <strong>Pratinjau berkas · {pratinjau.baris} baris · {pratinjau.kolom.length} kolom</strong>
        <div>Kolom: {pratinjau.kolom.join(', ')}</div>
        {pratinjau.kurang.length > 0 && <div className="warn">Kolom wajib tidak ditemukan: {pratinjau.kurang.join(', ')}</div>}
        {pratinjau.duplikat > 0 && <div className="warn">Ada {pratinjau.duplikat} identifier yang berulang dalam file.</div>}
        <small>Pratinjau hanya memeriksa struktur; validasi akhir tetap dilakukan sebelum data tersimpan.</small>
      </div>}
    </div>
  );
}

type RuangMonitoring = { id: string; kode: string; nama: string; kapasitas: number; peserta: number; sedang: number; selesai: number; dijeda: number; pengawas: string };

/** Monitoring Super Admin: daftar ruang yang bisa diklik, lalu masuk ke tabel peserta ruang tersebut. */
function MonitoringTab({ setError }: { setError: (m: string | null) => void }) {
  const [ujianList, setUjianList] = useState<{ id: string; kode: string; judul: string }[]>([]);
  const [ujianId, setUjianId] = useState('');
  const [ruangList, setRuangList] = useState<RuangMonitoring[]>([]);
  const [ruang, setRuang] = useState<RuangMonitoring | null>(null);

  useEffect(() => {
    baca<{ id: string; kode: string; judul: string }[]>('aksi=ujian')
      .then((d) => { setUjianList(d); if (d[0]) setUjianId(d[0].id); })
      .catch((e: Error) => setError(e.message));
  }, [setError]);

  useEffect(() => {
    if (!ujianId) return;
    setRuang(null);
    const muatRuang = () =>
      baca<RuangMonitoring[]>(`aksi=ruang-monitoring&ujianId=${ujianId}`)
        .then(setRuangList)
        .catch((e: Error) => setError(e.message));
    muatRuang();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void muatRuang(); }, 20_000);
    return () => clearInterval(t);
  }, [ujianId, setError]);

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Ujian</b>
          <select value={ujianId} onChange={(e) => setUjianId(e.target.value)} style={{ maxWidth: 420 }}>
            {ujianList.map((u) => <option key={u.id} value={u.id}>{u.kode} – {u.judul}</option>)}
          </select>
        </div>
      </div>

      {!ruang && (
        <div className="card">
          <h3>Ruang Ujian</h3>
          <div className="notice neutral" style={{ fontSize: 13 }}>Klik baris ruang untuk memantau peserta di ruang tersebut.</div>
          <table className="tabel">
            <thead>
              <tr>
                <th>Kode</th><th>Nama</th><th>Kapasitas</th><th>Peserta</th><th>Sedang ujian</th><th>Selesai</th><th>Dijeda</th><th>Pengawas</th>
              </tr>
            </thead>
            <tbody>
              {ruangList.map((r) => (
                <tr key={r.id} className="klik-baris" onClick={() => setRuang(r)}>
                  <td><b>{r.kode}</b></td>
                  <td>{r.nama}</td>
                  <td>{r.kapasitas}</td>
                  <td>{r.peserta}</td>
                  <td>{r.sedang}</td>
                  <td>{r.selesai}</td>
                  <td>{r.dijeda}</td>
                  <td>{r.pengawas || '—'}</td>
                </tr>
              ))}
              {ruangList.length === 0 && (
                <tr><td colSpan={8}>Belum ada ruang dengan penugasan pada ujian ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {ruang && (
        <div className="card">
          <div className="monitor-breadcrumb">
            <button className="btn outline" onClick={() => setRuang(null)}>← Daftar ruang</button>
            <b>Ruang {ruang.kode} – {ruang.nama}</b>
          </div>
          <MonitoringRuangTable ujianId={ujianId} ruangId={ruang.id} onError={setError} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Peserta (termasuk impor CSV)
 * ------------------------------------------------------------------ */
function PesertaTab({ rujukan, setError, setInfo }: Props) {
  const [bidang, setBidang] = useState('');
  const [daftar, setDaftar] = useState<{ id: string; username: string; nama: string; bidang: string; status: string }[]>([]);
  const [cari, setCari] = useState('');
  const [queryCari, setQueryCari] = useState('');
  const [halaman, setHalaman] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQueryCari(cari); setHalaman(1); }, 300); return () => clearTimeout(t); }, [cari]);
  const [form, setForm] = useState({ id: '', username: '', nama: '', bidang: '237', password: '', status: 'ACTIVE' });

  const muat = useCallback(() => {
    const q = new URLSearchParams({ aksi:'peserta-paged', page: String(halaman), search: queryCari });
    if (bidang) q.set('bidang',bidang);
    baca<{items:typeof daftar;total:number}>(q.toString())
      .then((d) => { setDaftar(d.items); setTotal(d.total); }).catch((e:Error) => setError(e.message));
  }, [bidang, halaman, queryCari, setError]);

  useEffect(() => { muat(); }, [muat]);

  async function simpan() {
    setError(null);
    try {
      await aksi({ aksi: 'simpan-peserta', data: form });
      setInfo('Peserta disimpan.');
      setForm({ id: '', username: '', nama: '', bidang: '237', password: '', status: 'ACTIVE' });
      muat();
    } catch (e) { setError((e as Error).message); }
  }

  async function resetPassword(p: { id: string; username: string; nama: string }) {
    if (!window.confirm(`Buat password baru untuk ${p.nama}? Password lama tidak berlaku dan sesi peserta diakhiri.`)) return;
    setError(null);
    try {
      const r = await aksi<{ username: string; password: string }>({ aksi: 'reset-password-peserta', data: { id: p.id } });
      setInfo(`Password baru untuk ${r.username}: ${r.password}. Catat sekarang, password ini tidak ditampilkan lagi.`);
    } catch (e) { setError((e as Error).message); }
  }

  async function imporBerkas(file: File): Promise<boolean> {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-peserta', berkas: await fileKeBase64(file), namaFile: file.name });
      setInfo(`${r.jumlah} peserta berhasil diimpor.`);
      muat();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <b>Daftar Peserta</b>
          <input aria-label="Cari nama atau username peserta" placeholder="Cari nama / username..." value={cari} onChange={(e) => setCari(e.target.value)} style={{ maxWidth: 250 }} />
          <select value={bidang} onChange={(e) => { setBidang(e.target.value); setHalaman(1); }} style={{ marginLeft: 'auto', padding: 6 }}>
            <option value="">Semua Bidang Studi</option>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabel">
            <thead><tr><th>Username</th><th>Nama</th><th>Bidang Studi</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td>{p.username}</td><td>{p.nama}</td><td>{p.bidang}</td><td>{p.status}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn outline" onClick={() => setForm({ id: p.id, username: p.username, nama: p.nama, bidang: p.bidang, password: '', status: p.status })}>Ubah</button>{' '}
                    <button className="btn outline" onClick={() => resetPassword(p)}>Reset password</button>
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={5}>Belum ada peserta.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-pages"><span>Menampilkan {daftar.length} dari {total} peserta · Halaman {halaman} / {Math.max(1,Math.ceil(total/25))}</span>
          <div><button className="btn outline" disabled={halaman<=1} onClick={() => setHalaman((v)=>v-1)}>← Sebelumnya</button>{' '}
          <button className="btn outline" disabled={halaman*25>=total} onClick={() => setHalaman((v)=>v+1)}>Berikutnya →</button></div></div>
      </div>

      <div className="card">
        <h3>{form.id ? 'Ubah Peserta (kosongkan password jika tidak diganti)' : 'Tambah Peserta'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Nama lengkap" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          <select value={form.bidang} onChange={(e) => setForm({ ...form, bidang: e.target.value })}>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
          <input type="password" placeholder="Password (min. 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Nonaktif</option>
          </select>
        </div>
        <div style={{ marginTop: 10 }}><button className="btn" onClick={simpan}>Simpan</button></div>
      </div>

      <div className="card">
        <ImporBox
          judul="Impor Peserta (Excel)"
          petunjuk={[
            <>Unduh template, lalu isi kolom <code>username</code>, <code>nama</code>, <code>bidang</code>, dan <code>password</code>.</>,
            <>Bidang berupa kode 3 digit sesuai sheet <b>Kode Bidang</b>, misalnya <code>237</code>.</>,
            <>Password minimal 8 karakter. Isi username dan bidang sebagai teks.</>,
            <>Simpan berkas, lalu unggah dan klik <b>Impor</b>.</>,
          ]}
          templateHref="/api/panitia?aksi=template-peserta"
          onImport={imporBerkas}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Pengawas
 * ------------------------------------------------------------------ */
function PengawasTab({ rujukan, onRefresh, setError, setInfo }: Props & { onRefresh: () => void }) {
  const [form, setForm] = useState({ username: '', nama: '', password: '' });

  async function imporBerkas(file: File): Promise<boolean> {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-pengawas', berkas: await fileKeBase64(file), namaFile: file.name });
      setInfo(`${r.jumlah} pengawas berhasil diimpor.`);
      onRefresh();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  async function simpan() {
    setError(null);
    try {
      await aksi({ aksi: 'simpan-pengawas', data: form });
      setInfo('Pengawas ditambahkan.');
      setForm({ username: '', nama: '', password: '' });
      onRefresh();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="card">
        <h3>Daftar Pengawas</h3>
        <ul>{rujukan.pengawas.map((p) => <li key={p.id}>{p.nama} ({p.username})</li>)}</ul>
        {rujukan.pengawas.length === 0 && <div>Belum ada Pengawas.</div>}
      </div>
      <div className="card">
        <h3>Tambah Pengawas</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <input placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input placeholder="Nama" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          <input type="password" placeholder="Password (min. 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div style={{ marginTop: 10 }}><button className="btn" onClick={simpan}>Simpan</button></div>
      </div>
      <div className="card">
        <ImporBox
          judul="Impor Pengawas (Excel)"
          petunjuk={[
            <>Unduh template, lalu isi kolom <code>username</code>, <code>nama</code>, dan <code>password</code>.</>,
            <>Password minimal 8 karakter. Username harus unik dan tanpa spasi.</>,
            <>Pengawas tidak terikat bidang studi. Penugasan ruang dilakukan di tab Ujian.</>,
          ]}
          templateHref="/api/panitia?aksi=template-pengawas"
          onImport={imporBerkas}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Soal
 * ------------------------------------------------------------------ */
type OpsiForm = { label: string; teks: string; benar: boolean };
const LABEL = ['A', 'B', 'C', 'D', 'E'];
const KOSONG_OPSI = (): OpsiForm[] => LABEL.map((l) => ({ label: l, teks: '', benar: false }));

function SoalTab({ rujukan, setError, setInfo }: Props) {
  const [bidang, setBidang] = useState('');
  const [tipe, setTipe] = useState('');
  const [daftar, setDaftar] = useState<{ id: string; kode: string | null; bidang: string; tipe: string; isi: string; status: string; jumlah_opsi: number }[]>([]);
  const [cari, setCari] = useState('');
  const [queryCari, setQueryCari] = useState('');
  const [halaman, setHalaman] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQueryCari(cari); setHalaman(1); }, 300); return () => clearTimeout(t); }, [cari]);
  const [form, setForm] = useState({ id: '', kode: '', bidang: '237', tipe: 'PILIHAN_GANDA', isi: '', rubrik: '', status: 'PUBLISHED' });
  const [opsi, setOpsi] = useState<OpsiForm[]>(KOSONG_OPSI());

  const muat = useCallback(() => {
    const q = new URLSearchParams({ aksi: 'soal-paged',page:String(halaman),search:queryCari });
    if (bidang) q.set('bidang', bidang);
    if (tipe) q.set('tipe', tipe);
    baca<{items:typeof daftar;total:number}>(q.toString()).then((d) => {setDaftar(d.items);setTotal(d.total);}).catch((e: Error) => setError(e.message));
  }, [bidang, tipe, halaman, queryCari, setError]);

  useEffect(() => { muat(); }, [muat]);

  async function imporSoalBerkas(file: File): Promise<boolean> {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-soal', berkas: await fileKeBase64(file), namaFile: file.name });
      setInfo(`${r.jumlah} soal berhasil diimpor.`);
      muat();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  async function ubah(id: string) {
    const d = await baca<{ kode: string | null; bidang: string; tipe: string; isi: string; rubrik: string | null; status: string; opsi: OpsiForm[] }>(`aksi=soal-detail&id=${id}`);
    setForm({ id, kode: d.kode ?? '', bidang: d.bidang, tipe: d.tipe, isi: d.isi, rubrik: d.rubrik ?? '', status: d.status });
    setOpsi(d.tipe === 'PILIHAN_GANDA' ? LABEL.map((l) => d.opsi.find((o) => o.label === l) ?? { label: l, teks: '', benar: false }) : KOSONG_OPSI());
  }

  async function simpan() {
    setError(null);
    try {
      await aksi({
        aksi: 'simpan-soal',
        data: { ...form, opsi: form.tipe === 'PILIHAN_GANDA' ? opsi.filter((o) => o.teks.trim()) : [] },
      });
      setInfo('Soal disimpan.');
      setForm({ id: '', kode: '', bidang: form.bidang, tipe: 'PILIHAN_GANDA', isi: '', rubrik: '', status: 'PUBLISHED' });
      setOpsi(KOSONG_OPSI());
      muat();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="card">
        <ImporBox
          judul="Impor Soal (Excel)"
          petunjuk={[
            <>Unduh template, lalu isi sheet <b>Soal</b>. Kolom: <code>kode</code>, <code>bidang</code>, <code>tipe</code>, <code>isi</code>, <code>opsi_a</code> sampai <code>opsi_e</code>, <code>kunci</code>, <code>rubrik</code>, <code>status</code>.</>,
            <>Tipe berupa <code>PILIHAN_GANDA</code> atau <code>ESAI</code>. Esai wajib memiliki <code>rubrik</code>.</>,
            <>Kunci berupa huruf A–E. Status <code>DRAFT</code> atau <code>PUBLISHED</code>, kosong berarti <code>PUBLISHED</code>.</>,
            <>Gambar tidak dapat dimasukkan lewat Excel. Tambahkan setelah impor lewat editor.</>,
          ]}
          templateHref="/api/panitia?aksi=template-soal"
          onImport={imporSoalBerkas}
        />
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input placeholder="Cari kode atau isi soal..." aria-label="Cari soal" value={cari} onChange={(e)=>setCari(e.target.value)} style={{maxWidth:280}} />
          <select value={bidang} onChange={(e) => { setBidang(e.target.value);setHalaman(1); }} style={{ padding: 6 }}>
            <option value="">Semua Bidang Studi</option>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
          <select value={tipe} onChange={(e) => { setTipe(e.target.value);setHalaman(1); }} style={{ padding: 6 }}>
            <option value="">Semua tipe</option>
            <option value="PILIHAN_GANDA">Pilihan ganda</option>
            <option value="ESAI">Esai</option>
          </select>
        </div>
        <table className="tabel">
          <thead><tr><th>Kode</th><th>Bidang</th><th>Tipe</th><th>Isi</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {daftar.map((s) => (
              <tr key={s.id}>
                <td>{s.kode ?? '—'}</td><td>{s.bidang}</td><td>{s.tipe === 'ESAI' ? 'Esai' : 'Pilihan ganda'}</td>
                <td style={{ maxWidth: 360 }}>{teksPolos(s.isi).slice(0, 90)}{teksPolos(s.isi).length > 90 ? '…' : ''}</td>
                <td>{s.status}</td>
                <td><button className="btn outline" onClick={() => ubah(s.id)}>Ubah</button></td>
              </tr>
            ))}
            {daftar.length === 0 && <tr><td colSpan={6}>Belum ada soal.</td></tr>}
          </tbody>
        </table>
        <div className="table-pages"><span>Menampilkan {daftar.length} dari {total} soal · Halaman {halaman} / {Math.max(1,Math.ceil(total/25))}</span>
          <div><button className="btn outline" disabled={halaman<=1} onClick={()=>setHalaman((v)=>v-1)}>← Sebelumnya</button>{' '}
          <button className="btn outline" disabled={halaman*25>=total} onClick={()=>setHalaman((v)=>v+1)}>Berikutnya →</button></div></div>
      </div>

      <div className="card">
        <h3>{form.id ? 'Ubah Soal' : 'Tambah Soal'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <input placeholder="Kode soal (opsional)" value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} />
          <select value={form.bidang} onChange={(e) => setForm({ ...form, bidang: e.target.value })}>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
          <select value={form.tipe} onChange={(e) => setForm({ ...form, tipe: e.target.value })}>
            <option value="PILIHAN_GANDA">Pilihan ganda</option>
            <option value="ESAI">Esai</option>
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARSIP">Arsip</option>
          </select>
        </div>
        <div style={{ marginTop: 8 }}>
          <RichEditor label="Isi soal" value={form.isi} onChange={(v) => setForm({ ...form, isi: v })} placeholder="Tulis isi soal. Gambar dapat disisipkan lewat toolbar." />
        </div>

        {form.tipe === 'PILIHAN_GANDA' ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Opsi jawaban (pilih satu yang benar)</div>
            {opsi.map((o, i) => (
              <div key={o.label} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 20 }}>{o.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <RichEditor label={`Opsi ${o.label}`} compact value={o.teks} onChange={(v) => setOpsi(opsi.map((x, j) => (j === i ? { ...x, teks: v } : x)))} />
                </div>
                <label style={{ fontSize: 13 }}>
                  <input type="radio" name="benar" checked={o.benar} onChange={() => setOpsi(opsi.map((x, j) => ({ ...x, benar: j === i })))} /> benar
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <RichEditor label="Rubrik penilaian (dipakai AI untuk memberi nilai 0–100)" value={form.rubrik} onChange={(v) => setForm({ ...form, rubrik: v })} placeholder="Tulis kriteria penilaian, skor per kriteria, dan contoh jawaban ideal." />
          </div>
        )}

        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={simpan}>Simpan</button>
          {form.id && <button className="btn outline" onClick={() => { setForm({ id: '', kode: '', bidang: form.bidang, tipe: 'PILIHAN_GANDA', isi: '', rubrik: '', status: 'PUBLISHED' }); setOpsi(KOSONG_OPSI()); }}>Batal ubah</button>}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Ujian: data, jadwal dua bagian, soal, SEB, penugasan, token, pengawas
 * ------------------------------------------------------------------ */
type Detail = {
  id: string; kode: string; judul: string; bidang: string; mode_token: string; token_sama: string | null;
  status: string; seb_wajib: boolean; sudahMulai: boolean;
  bagian: { tipe: string; durasi_menit: number; mulai: string; selesai: string }[];
  soal: { soal_id: string; urutan: number; tipe: string; isi: string }[];
  seb: string[];
  ruang: { id: string; kode: string; nama: string; kapasitas: number; peserta: number; token: string | null; pengawas: string[] }[];
  pesertaBidang: { id: string; nama: string; username: string; ruang_id: string | null }[];
};

const KOSONG_UJIAN = { id: '', kode: '', judul: '', bidang: '237', mode_token: 'PER_RUANG', token_sama: '', status: 'DRAFT', seb_wajib: true };

/* ------------------------------------------------------------------ *
 * Konfigurasi SEB (Browser Exam Key disimpan di server, tidak ditampilkan lagi)
 * ------------------------------------------------------------------ */
function SebCard({ seb, onRefresh, setError, setInfo }: { seb: Seb[]; onRefresh: () => void; setError: (m: string | null) => void; setInfo: (m: string | null) => void }) {
  const [nama, setNama] = useState('');
  const [platform, setPlatform] = useState('WINDOWS');
  const [bek, setBek] = useState('');
  const [simpanBusy, setSimpanBusy] = useState(false);

  async function tambah() {
    setError(null);
    setSimpanBusy(true);
    try {
      await aksi({ aksi: 'simpan-seb', data: { nama, platform, bek } });
      setInfo('Konfigurasi SEB ditambahkan.');
      setNama('');
      setBek('');
      onRefresh();
    } catch (e) { setError((e as Error).message); }
    finally { setSimpanBusy(false); }
  }

  async function gantiStatus(item: Seb) {
    setError(null);
    try {
      await aksi({ aksi: 'ubah-status-seb', data: { id: item.id, aktif: !item.aktif } });
      onRefresh();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="card">
      <h3>Konfigurasi SEB</h3>
      <div className="notice neutral" style={{ fontSize: 13 }}>
        Masukkan BEK SHA-256 (64 karakter heksadesimal) setelah menyimpan file <code>.seb</code> final. Kunci disimpan aman di server dan tidak ditampilkan lagi. SEB klasik Windows memerlukan header RequestHash; kompatibilitas SEB macOS modern harus diuji dengan perangkat asli.
      </div>

      {seb.length === 0 ? (
        <div className="notice neutral" style={{ fontSize: 13 }}>Belum ada konfigurasi SEB. Tambahkan di bawah.</div>
      ) : (
        <table className="tabel" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>Nama</th><th>Platform</th><th>Dipakai ujian</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {seb.map((x) => (
              <tr key={x.id}>
                <td>{x.nama}</td>
                <td>{x.platform}</td>
                <td>{x.jumlah_ujian}</td>
                <td>{x.aktif ? 'Aktif' : 'Nonaktif'}</td>
                <td><button className="btn outline" onClick={() => gantiStatus(x)}>{x.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(160px,1fr) 140px minmax(200px,2fr) auto', alignItems: 'center' }}>
        <input placeholder="Nama konfigurasi, misalnya SEB Windows Tryout" value={nama} onChange={(e) => setNama(e.target.value)} />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="WINDOWS">Windows</option>
          <option value="MACOS">macOS</option>
        </select>
        <input type="password" autoComplete="off" placeholder="Browser Exam Key (BEK)" value={bek} onChange={(e) => setBek(e.target.value)} />
        <button className="btn" disabled={simpanBusy || !nama.trim() || !/^[a-f0-9]{64}$/i.test(bek.trim())} onClick={tambah}>Tambah</button>
      </div>
    </div>
  );
}

function UjianTab({ rujukan, onRefresh, setError, setInfo }: Props & { onRefresh: () => void }) {
  const [daftar, setDaftar] = useState<{ id: string; kode: string; judul: string; status: string; bidang: string; peserta: number; sudah_mulai: number }[]>([]);
  const [form, setForm] = useState(KOSONG_UJIAN);
  const [bagian, setBagian] = useState({
    PILIHAN_GANDA: { durasi: '60', mulai: '', selesai: '' },
    ESAI: { durasi: '60', mulai: '', selesai: '' },
  });
  const [soalIds, setSoalIds] = useState<string[]>([]);
  const [sebIds, setSebIds] = useState<string[]>([]);
  const [bankSoal, setBankSoal] = useState<{ id: string; tipe: string; isi: string; kode: string | null }[]>([]);
  const [bankCari, setBankCari] = useState('');
  const [bankCariAktif, setBankCariAktif] = useState('');
  const [bankPage, setBankPage] = useState(1);
  const [bankTotal, setBankTotal] = useState(0);
  const [metadataTerpilih, setMetadataTerpilih] = useState<Record<string,{kode:string|null;tipe:string;isi:string}>>({});
  const [cariPenugasan,setCariPenugasan] = useState('');
  const [pagePenugasan,setPagePenugasan] = useState(1);
  const [pilihRuangMassal,setPilihRuangMassal] = useState('');
  useEffect(() => {const t=setTimeout(()=>{setBankCariAktif(bankCari);setBankPage(1);},300);return ()=>clearTimeout(t);},[bankCari]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [penugasan, setPenugasan] = useState<Record<string, string>>({});
  const [pengawasRuang, setPengawasRuang] = useState<Record<string, string[]>>({});

  const muatDaftar = useCallback(() => {
    baca<typeof daftar>('aksi=ujian').then(setDaftar).catch((e: Error) => setError(e.message));
  }, [setError]);
  useEffect(() => { muatDaftar(); }, [muatDaftar]);

  // Bank soal PUBLISHED sesuai Bidang Studi ujian yang sedang diedit.
  useEffect(() => {
    const q = new URLSearchParams({aksi:'soal-bank-paged',bidang:form.bidang,page:String(bankPage),search:bankCariAktif});
    baca<{items:typeof bankSoal;total:number}>(q.toString())
      .then((r) => {
        setBankSoal(r.items);setBankTotal(r.total);
        setMetadataTerpilih((prev) => ({...prev,...Object.fromEntries(r.items.map((s)=>[s.id,{kode:s.kode,tipe:s.tipe,isi:s.isi}]))}));
      })
      .catch(() => setBankSoal([]));
  }, [form.bidang,bankPage,bankCariAktif]);

  async function salin(id: string) {
    setError(null);
    try {
      const r = await aksi<{ id: string }>({ aksi: 'salin-ujian', ujianId: id });
      setInfo('Ujian disalin sebagai DRAFT. Periksa jadwal dan penugasan sebelum dipublikasikan.');
      muatDaftar();
      buka(r.id);
    } catch (e) { setError((e as Error).message); }
  }

  async function buka(id: string) {
    const d = await baca<Detail>(`aksi=ujian-detail&id=${id}`);
    setDetail(d);
    setForm({ id: d.id, kode: d.kode, judul: d.judul, bidang: d.bidang, mode_token: d.mode_token, token_sama: d.token_sama ?? '', status: d.status, seb_wajib: d.seb_wajib });
    const pg = d.bagian.find((b) => b.tipe === 'PILIHAN_GANDA');
    const es = d.bagian.find((b) => b.tipe === 'ESAI');
    setBagian({
      PILIHAN_GANDA: { durasi: String(pg?.durasi_menit ?? 60), mulai: keInputLokal(pg?.mulai), selesai: keInputLokal(pg?.selesai) },
      ESAI: { durasi: String(es?.durasi_menit ?? 60), mulai: keInputLokal(es?.mulai), selesai: keInputLokal(es?.selesai) },
    });
    setSoalIds(d.soal.map((s) => s.soal_id));
    setMetadataTerpilih((prev)=>({...prev,...Object.fromEntries(d.soal.map((s)=>[s.soal_id,{kode:null,tipe:s.tipe,isi:s.isi}]))}));
    setSebIds(d.seb);
    setPenugasan(Object.fromEntries(d.pesertaBidang.filter((p) => p.ruang_id).map((p) => [p.id, p.ruang_id as string])));
    setPengawasRuang(Object.fromEntries(d.ruang.map((r) => [r.id, r.pengawas])));
  }

  function baru() {
    setForm(KOSONG_UJIAN);
    setDetail(null);
    setSoalIds([]);
    setMetadataTerpilih({});
    setSebIds([]);
    setPenugasan({});
    setPengawasRuang({});
    setBagian({ PILIHAN_GANDA: { durasi: '60', mulai: '', selesai: '' }, ESAI: { durasi: '60', mulai: '', selesai: '' } });
  }

  async function simpanUjian() {
    setError(null);
    try {
      const payload = {
        ...form,
        token_sama: undefined,
        tokenSama: form.token_sama,
        modeToken: form.mode_token,
        sebWajib: form.seb_wajib,
        soalIds,
        sebIds,
        bagian: (['PILIHAN_GANDA', 'ESAI'] as const).map((tipe) => ({
          tipe,
          durasiMenit: Number(bagian[tipe].durasi),
          mulai: new Date(bagian[tipe].mulai).toISOString(),
          selesai: new Date(bagian[tipe].selesai).toISOString(),
        })),
      };
      const r = await aksi<{ id: string }>({ aksi: 'simpan-ujian', data: payload });
      setInfo('Ujian disimpan. Atur penugasan peserta dan Pengawas di bawah.');
      await buka(r.id);
      muatDaftar();
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function simpanPenugasan() {
    if (!detail) return;
    setError(null);
    try {
      const peserta = Object.entries(penugasan).filter(([, ruang]) => ruang).map(([userId, ruangId]) => ({ userId, ruangId }));
      const pengawas = Object.entries(pengawasRuang).flatMap(([ruangId, ids]) => ids.map((pengawasId) => ({ ruangId, pengawasId })));
      await aksi({ aksi: 'simpan-penugasan', ujianId: detail.id, data: { peserta, pengawas } });
      setInfo('Penugasan disimpan. Token lama dipertahankan; token baru hanya untuk ruang baru.');
      await buka(detail.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function ulangToken(ruangId: string) {
    if (!detail) return;
    try {
      await aksi({ aksi: 'buat-ulang-token', ujianId: detail.id, ruangId });
      await buka(detail.id);
      setInfo('Token ruang dibuat ulang.');
    } catch (e) { setError((e as Error).message); }
  }

  const pesertaTersedia = detail?.pesertaBidang ?? [];
  const pesertaTerfilter = pesertaTersedia.filter((p) => `${p.nama} ${p.username}`.toLowerCase().includes(cariPenugasan.toLowerCase()));
  const pesertaTerlihat = pesertaTerfilter.slice((pagePenugasan-1)*50,pagePenugasan*50);
  const pesertaRuang = (ruangId: string) => Object.values(penugasan).filter((r) => r === ruangId).length;

  return (
    <>
      <SebCard seb={rujukan.seb} onRefresh={onRefresh} setError={setError} setInfo={setInfo} />
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <b>Daftar Ujian</b>
          <button className="btn" onClick={baru}>+ Ujian baru</button>
        </div>
        <table className="tabel">
          <thead><tr><th>Kode</th><th>Judul</th><th>Bidang</th><th>Status</th><th>Peserta</th><th>Sudah mulai</th><th></th></tr></thead>
          <tbody>
            {daftar.map((u) => (
              <tr key={u.id}>
                <td>{u.kode}</td><td>{u.judul}</td><td>{u.bidang}</td><td>{u.status}</td><td>{u.peserta}</td><td>{u.sudah_mulai}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn outline" onClick={() => buka(u.id)}>Buka</button>{' '}
                  <button className="btn outline" onClick={() => salin(u.id)}>Salin</button>
                </td>
              </tr>
            ))}
            {daftar.length === 0 && <tr><td colSpan={7}>Belum ada ujian.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>{form.id ? 'Ubah Ujian' : 'Ujian Baru'}</h3>
        {detail?.sudahMulai && <div className="info" style={{ marginBottom: 8 }}>Ujian ini sudah dikerjakan peserta. Jadwal, soal, dan penugasan tidak dapat diubah.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <input placeholder="Kode ujian" value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} />
          <input placeholder="Judul ujian" value={form.judul} onChange={(e) => setForm({ ...form, judul: e.target.value })} />
          <select value={form.bidang} onChange={(e) => { setForm({ ...form, bidang: e.target.value }); setSoalIds([]); }}>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="DRAFT">Draft</option>
            <option value="TERJADWAL">Terjadwal</option>
            <option value="AKTIF">Aktif</option>
            <option value="SELESAI">Selesai</option>
            <option value="ARSIP">Arsip</option>
          </select>
          <select value={form.mode_token} onChange={(e) => setForm({ ...form, mode_token: e.target.value })}>
            <option value="PER_RUANG">Token per ruang</option>
            <option value="SAMA">Satu token untuk semua</option>
          </select>
          {form.mode_token === 'SAMA' && (
            <input placeholder="Token (kosongkan untuk dibuat otomatis)" maxLength={6} value={form.token_sama} onChange={(e) => setForm({ ...form, token_sama: e.target.value.toUpperCase() })} />
          )}
          <label style={{ fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={form.seb_wajib} onChange={(e) => setForm({ ...form, seb_wajib: e.target.checked })} /> Wajib SEB
          </label>
        </div>

        <h3 style={{ marginTop: 14, fontSize: 15 }}>Jadwal dua bagian</h3>
        {(['PILIHAN_GANDA', 'ESAI'] as const).map((tipe) => (
          <div key={tipe} style={{ display: 'grid', gridTemplateColumns: '130px 110px 1fr 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>{tipe === 'PILIHAN_GANDA' ? 'Pilihan ganda' : 'Esai'}</b>
            <input type="number" min={1} value={bagian[tipe].durasi} onChange={(e) => setBagian({ ...bagian, [tipe]: { ...bagian[tipe], durasi: e.target.value } })} placeholder="Menit" />
            <input type="datetime-local" value={bagian[tipe].mulai} onChange={(e) => setBagian({ ...bagian, [tipe]: { ...bagian[tipe], mulai: e.target.value } })} />
            <input type="datetime-local" value={bagian[tipe].selesai} onChange={(e) => setBagian({ ...bagian, [tipe]: { ...bagian[tipe], selesai: e.target.value } })} />
          </div>
        ))}

        <h3 style={{ marginTop: 14, fontSize: 15 }}>Soal (urutan sesuai centang) · {soalIds.length} terpilih</h3>
        <div className="table-toolbar"><input aria-label="Cari bank soal" placeholder="Cari kode atau isi bank soal..." value={bankCari} onChange={(e)=>setBankCari(e.target.value)} />
        <span>{bankTotal} soal sesuai pencarian</span></div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d7dde6', borderRadius: 6, padding: 8 }}>
          {bankSoal.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: 8, fontSize: 14, marginBottom: 4 }}>
              <input type="checkbox" checked={soalIds.includes(s.id)} onChange={(e) => setSoalIds(e.target.checked ? [...soalIds, s.id] : soalIds.filter((x) => x !== s.id))} />
              <span>[{s.tipe === 'ESAI' ? 'Esai' : 'PG'}] {s.kode ? `${s.kode} – ` : ''}{teksPolos(s.isi).slice(0, 100)}</span>
            </label>
          ))}
          {bankSoal.length === 0 && <div style={{ fontSize: 13 }}>Tidak ada soal yang cocok. Gunakan pencarian.</div>}
        </div>
        <div className="table-pages"><span>Halaman bank soal {bankPage} / {Math.max(1,Math.ceil(bankTotal/50))}</span>
          <div><button className="btn outline" disabled={bankPage<=1} onClick={()=>setBankPage((v)=>v-1)}>←</button>{' '}
          <button className="btn outline" disabled={bankPage*50>=bankTotal} onClick={()=>setBankPage((v)=>v+1)}>→</button></div></div>
        {soalIds.length>0 && <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>Lihat {soalIds.length} soal terpilih (klik untuk hapus)</summary>
          <div style={{maxHeight:150,overflow:'auto',marginTop:8}}>{soalIds.map((id,i)=><div key={id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 0',borderBottom:'1px solid #edf2f7'}}>
            <span>{i+1}. {metadataTerpilih[id]?.kode || metadataTerpilih[id]?.isi?.slice(0,80) || id}</span>
            <button className="btn outline" type="button" onClick={()=>setSoalIds((ids)=>ids.filter((x)=>x!==id))}>Hapus</button></div>)}</div>
        </details>}

        <h3 style={{ marginTop: 14, fontSize: 15 }}>Konfigurasi SEB</h3>
        {rujukan.seb.length === 0 && <div className="info" style={{ fontSize: 13 }}>Belum ada konfigurasi SEB. Tambahkan di kartu Konfigurasi SEB pada tab ini.</div>}
        {rujukan.seb.map((s) => (
          <label key={s.id} style={{ display: 'flex', gap: 8, fontSize: 14, marginBottom: 4 }}>
            <input type="checkbox" checked={sebIds.includes(s.id)} onChange={(e) => setSebIds(e.target.checked ? [...sebIds, s.id] : sebIds.filter((x) => x !== s.id))} />
            {s.nama} ({s.platform})
          </label>
        ))}

        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={!!detail?.sudahMulai} onClick={simpanUjian}>Simpan Ujian</button>
        </div>
      </div>

      {detail && (
        <>
          <div className="card">
            <h3>Ruang dan Pengawas</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="tabel">
                <thead>
                  <tr><th>Ruang</th><th>Kapasitas</th><th>Peserta</th><th>Token</th><th>Pengawas</th><th></th></tr>
                </thead>
                <tbody>
                  {rujukan.ruang.map((r) => {
                    const dt = detail.ruang.find((x) => x.id === r.id);
                    return (
                      <tr key={r.id}>
                        <td>{r.kode} – {r.nama}</td>
                        <td>{r.kapasitas}</td>
                        <td>{pesertaRuang(r.id)}</td>
                        <td>{detail.mode_token === 'PER_RUANG' ? (dt?.token ?? '—') : (detail.token_sama ?? '—')}</td>
                        <td>
                          {rujukan.pengawas.map((p) => (
                            <label key={p.id} style={{ display: 'block', fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={(pengawasRuang[r.id] ?? []).includes(p.id)}
                                onChange={(e) => {
                                  const cur = pengawasRuang[r.id] ?? [];
                                  setPengawasRuang({ ...pengawasRuang, [r.id]: e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id) });
                                }}
                              />{' '}{p.nama}
                            </label>
                          ))}
                        </td>
                        <td>
                          {dt?.token && detail.mode_token === 'PER_RUANG' && (
                            <button className="btn outline" onClick={() => ulangToken(r.id)} disabled={detail.sudahMulai}>Token baru</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Penugasan Peserta ({detail.bidang})</h3>
            <div style={{ fontSize: 13, marginBottom: 8 }}>Pilih ruang untuk setiap peserta. Menampilkan 50 peserta per halaman; semua pilihan disimpan bersama.</div>
            <div className="table-toolbar"><input aria-label="Cari peserta untuk penugasan" placeholder="Cari nama/username peserta..." value={cariPenugasan} onChange={(e)=>{setCariPenugasan(e.target.value);setPagePenugasan(1);}} />
            <select value={pilihRuangMassal} onChange={(e)=>setPilihRuangMassal(e.target.value)} style={{maxWidth:260}}><option value="">Pilih ruang massal...</option>
              {rujukan.ruang.map((r)=><option key={r.id} value={r.id}>{r.kode} – {r.nama}</option>)}</select>
            <button className="btn outline" disabled={detail.sudahMulai||!pilihRuangMassal||!pesertaTerlihat.length} onClick={()=>setPenugasan((prev)=>({...prev,...Object.fromEntries(pesertaTerlihat.map((r)=>[r.id,pilihRuangMassal]))}))}>Terapkan ke {pesertaTerlihat.length} terlihat</button></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tabel">
                <thead><tr><th>Nama</th><th>Username</th><th>Ruang</th></tr></thead>
                <tbody>
                  {pesertaTerlihat.map((p) => (
                    <tr key={p.id}>
                      <td>{p.nama}</td><td>{p.username}</td>
                      <td>
                        <select disabled={detail.sudahMulai} value={penugasan[p.id] ?? ''} onChange={(e) => setPenugasan({ ...penugasan, [p.id]: e.target.value })}>
                          <option value="">— belum ditempatkan —</option>
                          {rujukan.ruang.map((r) => <option key={r.id} value={r.id}>{r.kode} – {r.nama}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {pesertaTerfilter.length === 0 && <tr><td colSpan={3}>Tidak ada peserta yang cocok.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-pages"><span>Menampilkan {pesertaTerlihat.length} dari {pesertaTerfilter.length} peserta · Halaman {pagePenugasan} / {Math.max(1,Math.ceil(pesertaTerfilter.length/50))}</span>
              <div><button className="btn outline" disabled={pagePenugasan<=1} onClick={()=>setPagePenugasan((v)=>v-1)}>←</button>{' '}
              <button className="btn outline" disabled={pagePenugasan*50>=pesertaTerfilter.length} onClick={()=>setPagePenugasan((v)=>v+1)}>→</button></div></div>
            <div style={{ marginTop: 10 }}>
              <button className="btn" disabled={detail.sudahMulai} onClick={simpanPenugasan}>Simpan Penugasan</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Nilai esai: ekspor, impor hasil AI, publikasi, dan hasil
 * ------------------------------------------------------------------ */
function NilaiTab({ setError, setInfo }: Omit<Props, 'rujukan'> & { rujukan: Rujukan }) {
  const [ujian, setUjian] = useState<{ id: string; kode: string; judul: string; status: string }[]>([]);
  const [ujianId, setUjianId] = useState('');
  const [hasil, setHasil] = useState<{ totalPilihanGanda: number; rows: { nama: string; username: string; status: string; skor_pilihan_ganda: number | null; skor_esai: string | null }[] } | null>(null);

  useEffect(() => {
    baca<typeof ujian>('aksi=ujian').then(setUjian).catch((e: Error) => setError(e.message));
  }, [setError]);

  const muatHasil = useCallback(() => {
    if (!ujianId) return;
    baca<typeof hasil>(`aksi=hasil&ujianId=${ujianId}`).then(setHasil).catch((e: Error) => setError(e.message));
  }, [ujianId, setError]);
  useEffect(() => { muatHasil(); }, [muatHasil]);

  async function imporNilai(file: File): Promise<boolean> {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-esai', ujianId, berkas: await fileKeBase64(file), namaFile: file.name });
      setInfo(`${r.jumlah} nilai esai berhasil diimpor.`);
      muatHasil();
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  async function publikasi() {
    if (!window.confirm('Publikasikan hasil ujian ini? Peserta akan dapat melihat nilainya.')) return;
    setError(null);
    try {
      await aksi({ aksi: 'publikasi', ujianId });
      setInfo('Hasil dipublikasikan.');
      baca<typeof ujian>('aksi=ujian').then(setUjian);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="card">
        <label style={{ fontSize: 14 }}>Pilih ujian: </label>
        <select value={ujianId} onChange={(e) => setUjianId(e.target.value)} style={{ padding: 6, minWidth: 280 }}>
          <option value="">— pilih ujian —</option>
          {ujian.map((u) => <option key={u.id} value={u.id}>{u.kode} – {u.judul} ({u.status})</option>)}
        </select>
      </div>

      {ujianId && (
        <>
          <div className="card">
            <h3>Penilaian Esai</h3>
            <ol style={{ fontSize: 14, lineHeight: 1.7 }}>
              <li>Unduh esai (CSV berisi ID pengerjaan dan rubrik, tanpa nama peserta).</li>
              <li>Koreksi dengan AI menggunakan rubrik, lalu isi kolom <code>skor</code> (0–100) dan <code>umpan_balik</code> di template Excel.</li>
              <li>Unggah kembali hasil koreksi dalam format Excel (.xlsx) atau CSV.</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <a className="btn outline" href={`/api/panitia?aksi=ekspor-esai&ujianId=${ujianId}`}>Unduh Esai (CSV)</a>
              <a className="btn outline" href="/api/panitia?aksi=template-esai">Unduh Template Excel</a>
            </div>
          </div>

          <div className="card">
            <ImporBox
              judul="Unggah Hasil Koreksi Esai (Excel)"
              petunjuk={[
                <>Unduh template, lalu isi kolom <code>pengerjaan_id</code>, <code>soal_id</code>, <code>skor</code> (0–100), dan <code>umpan_balik</code>.</>,
                <><code>pengerjaan_id</code> dan <code>soal_id</code> disalin dari ekspor esai (CSV).</>,
                <>Satu baris salah membatalkan seluruh impor.</>,
              ]}
              templateHref="/api/panitia?aksi=template-esai"
              onImport={imporNilai}
            />
          </div>


          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Hasil</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn outline" href={`/api/panitia?aksi=ekspor-hasil&ujianId=${ujianId}`}>Unduh Hasil (Excel)</a>
                <button className="btn hijau" onClick={publikasi}>Publikasikan Hasil</button>
              </div>
            </div>
            <table className="tabel">
              <thead><tr><th>Nama</th><th>Username</th><th>Status</th><th>PG (benar dari {hasil?.totalPilihanGanda ?? 0})</th><th>Esai (0–100)</th></tr></thead>
              <tbody>
                {hasil?.rows.map((r) => (
                  <tr key={r.username}>
                    <td>{r.nama}</td><td>{r.username}</td><td>{r.status}</td>
                    <td>{r.skor_pilihan_ganda ?? '—'}</td><td>{r.skor_esai ?? 'menunggu'}</td>
                  </tr>
                ))}
                {hasil && hasil.rows.length === 0 && <tr><td colSpan={5}>Belum ada pengerjaan.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Berita acara: dikirim setelah ujian selesai, per ruang
 * ------------------------------------------------------------------ */
type IsiBeritaAcara = {
  ujian: { kode: string; judul: string; bidang: string; mulai: string | null; selesai: string | null };
  ruang: { kode: string; nama: string; kapasitas: number };
  pengawas: string[];
  peserta: { nama: string; username: string; status: string; skorPilihanGanda: number | null; pelanggaranFokus: number; totalJedaDetik: number }[];
  ringkasan: { jumlahPeserta: number; hadir: number; tidakHadir: number; selesai: number; masihAktif: number; totalPelanggaranFokus: number };
};
type BeritaRuang = { id: string; kode: string; nama: string; peserta: number; pengawas: string; dikirim_at: string | null };
const LABEL_STATUS: Record<string, string> = {
  TIDAK_HADIR: 'Tidak hadir',
  AKTIF: 'Sedang mengerjakan',
  SELESAI: 'Selesai',
  DIHENTIKAN: 'Dihentikan',
};

function BeritaTab({ setError, setInfo }: { setError: (m: string | null) => void; setInfo: (m: string | null) => void }) {
  const [ujian, setUjian] = useState<{ id: string; kode: string; judul: string; status: string }[]>([]);
  const [ujianId, setUjianId] = useState('');
  const [siap, setSiap] = useState(false);
  const [ruang, setRuang] = useState<BeritaRuang[]>([]);
  const [lihat, setLihat] = useState<{ ruangId: string; terkirim: boolean; dikirimAt: string | null; dikirimOleh: string | null; data: IsiBeritaAcara } | null>(null);

  useEffect(() => {
    baca<typeof ujian>('aksi=ujian').then(setUjian).catch((e: Error) => setError(e.message));
  }, [setError]);

  const muat = useCallback(() => {
    if (!ujianId) { setRuang([]); setSiap(false); return; }
    baca<{ siap: boolean; ruang: BeritaRuang[] }>(`aksi=berita-daftar&ujianId=${ujianId}`)
      .then((d) => { setSiap(d.siap); setRuang(d.ruang); })
      .catch((e: Error) => setError(e.message));
  }, [ujianId, setError]);

  useEffect(() => { setLihat(null); muat(); }, [muat]);

  async function bukaRuang(ruangId: string) {
    setError(null);
    try {
      const d = await baca<Omit<NonNullable<typeof lihat>, 'ruangId'>>(`aksi=berita-acara&ujianId=${ujianId}&ruangId=${ruangId}`);
      setLihat({ ruangId, ...d });
    } catch (e) { setError((e as Error).message); }
  }

  async function kirim(r: BeritaRuang) {
    if (!window.confirm(`Kirim berita acara ruang ${r.kode}? Setelah dikirim, isinya tidak dapat diubah.`)) return;
    setError(null);
    try {
      await aksi({ aksi: 'kirim-berita-acara', ujianId, ruangId: r.id });
      setInfo(`Berita acara ruang ${r.kode} berhasil dikirim.`);
      muat();
      bukaRuang(r.id);
    } catch (e) { setError((e as Error).message); }
  }

  const isi = lihat?.data;
  const namaRuang = lihat ? ruang.find((x) => x.id === lihat.ruangId)?.kode ?? '' : '';

  return (
    <>
      <div className="card">
        <label style={{ fontSize: 14 }}>Pilih ujian: </label>
        <select value={ujianId} onChange={(e) => setUjianId(e.target.value)} style={{ padding: 6, minWidth: 280 }}>
          <option value="">— pilih ujian —</option>
          {ujian.map((u) => <option key={u.id} value={u.id}>{u.kode} – {u.judul} ({u.status})</option>)}
        </select>
        {ujianId && (
          <div className="info" style={{ fontSize: 13, marginTop: 10 }}>
            {siap
              ? 'Ujian sudah selesai. Berita acara dapat dikirim untuk setiap ruang.'
              : 'Berita acara dapat dikirim setelah waktu ujian berakhir.'}
          </div>
        )}
      </div>

      {ujianId && (
        <div className="card">
          <b>Ruang Ujian</b>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="tabel">
              <thead><tr><th>Ruang</th><th>Peserta</th><th>Pengawas</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {ruang.map((r) => (
                  <tr key={r.id}>
                    <td>{r.kode} – {r.nama}</td>
                    <td>{r.peserta}</td>
                    <td>{r.pengawas || '—'}</td>
                    <td>
                      {r.dikirim_at ? `Terkirim ${fmtWaktu(r.dikirim_at)}` : siap ? 'Siap dikirim' : 'Menunggu ujian selesai'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn outline" onClick={() => bukaRuang(r.id)}>Lihat</button>{' '}
                      <button className="btn" disabled={!siap || !!r.dikirim_at || r.peserta === 0} onClick={() => kirim(r)}>Kirim</button>
                    </td>
                  </tr>
                ))}
                {ruang.length === 0 && <tr><td colSpan={5}>Belum ada ruang yang ditugaskan untuk ujian ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lihat && isi && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <b>Berita Acara Ruang {namaRuang}</b>
            <span style={{ fontSize: 13 }}>
              {lihat.terkirim
                ? `Terkirim ${fmtWaktu(lihat.dikirimAt as string)} oleh ${lihat.dikirimOleh ?? '-'}`
                : 'Pratinjau (belum dikirim)'}
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <div><b>Ujian:</b> {isi.ujian.kode} – {isi.ujian.judul} ({isi.ujian.bidang})</div>
            <div><b>Ruang:</b> {isi.ruang.kode} – {isi.ruang.nama} (kapasitas {isi.ruang.kapasitas})</div>
            <div><b>Jadwal:</b> {isi.ujian.mulai ? fmtWaktu(isi.ujian.mulai) : '—'} s.d. {isi.ujian.selesai ? fmtWaktu(isi.ujian.selesai) : '—'}</div>
            <div><b>Pengawas:</b> {isi.pengawas.length ? isi.pengawas.join(', ') : '—'}</div>
            <div>
              <b>Ringkasan:</b> {isi.ringkasan.jumlahPeserta} peserta terdaftar, {isi.ringkasan.hadir} hadir,
              {' '}{isi.ringkasan.tidakHadir} tidak hadir, {isi.ringkasan.selesai} selesai,
              {' '}{isi.ringkasan.masihAktif} masih mengerjakan, {isi.ringkasan.totalPelanggaranFokus} pelanggaran fokus.
            </div>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="tabel">
              <thead><tr><th>No</th><th>Nama</th><th>Username</th><th>Status</th><th>PG benar</th><th>Pelanggaran fokus</th><th>Jeda</th></tr></thead>
              <tbody>
                {isi.peserta.map((p, i) => (
                  <tr key={p.username}>
                    <td>{i + 1}</td>
                    <td>{p.nama}</td>
                    <td>{p.username}</td>
                    <td>{LABEL_STATUS[p.status] ?? p.status}</td>
                    <td>{p.skorPilihanGanda ?? '—'}</td>
                    <td>{p.pelanggaranFokus}</td>
                    <td>{p.totalJedaDetik > 0 ? fmtDetik(p.totalJedaDetik) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!lihat.terkirim && (
            <div className="info" style={{ fontSize: 13, marginTop: 10 }}>
              Pratinjau ini belum tersimpan. Setelah dikirim, isi berita acara disimpan apa adanya dan tidak berubah.
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Log aktivitas
 * ------------------------------------------------------------------ */
const LABEL_LOG: Record<string, string> = {
  IMPOR_PESERTA: 'Impor peserta',
  IMPOR_SOAL: 'Impor soal',
  IMPOR_PENGAWAS: 'Impor pengawas',
  IMPOR_RUANG: 'Impor ruang',
  IMPOR_NILAI_ESAI: 'Impor nilai esai',
  RESET_PASSWORD_PESERTA: 'Reset password peserta',
  SALIN_UJIAN: 'Salin ujian',
  BUAT_ULANG_TOKEN: 'Buat ulang token ruang',
  PUBLIKASI_HASIL: 'Publikasi hasil',
  KIRIM_BERITA_ACARA: 'Kirim berita acara',
};

function LogTab({ setError }: { setError: (m: string | null) => void }) {
  const [daftar, setDaftar] = useState<{ waktu: string; pelaku: string; aksi: string; target: string | null; detail: unknown }[]>([]);

  const muat = useCallback(() => {
    baca<typeof daftar>('aksi=log').then(setDaftar).catch((e: Error) => setError(e.message));
  }, [setError]);
  useEffect(() => { muat(); }, [muat]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>Log Aktivitas</b>
        <button className="btn outline" onClick={muat}>Muat ulang</button>
      </div>
      <div className="info" style={{ fontSize: 13, marginBottom: 8 }}>
        Menampilkan 200 aktivitas terakhir: impor, reset password, salin ujian, publikasi, dan pengiriman berita acara.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabel">
          <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aktivitas</th><th>Target</th><th>Rincian</th></tr></thead>
          <tbody>
            {daftar.map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtWaktu(r.waktu)}</td>
                <td>{r.pelaku}</td>
                <td>{LABEL_LOG[r.aksi] ?? r.aksi}</td>
                <td>{r.target ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{r.detail ? JSON.stringify(r.detail) : '—'}</td>
              </tr>
            ))}
            {daftar.length === 0 && <tr><td colSpan={5}>Belum ada aktivitas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
