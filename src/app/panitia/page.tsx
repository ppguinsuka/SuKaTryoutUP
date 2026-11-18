'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, post } from '@/lib/client';
import { AdminShell } from '@/components/admin-shell';
import '../admin-theme.css';

type Tab = 'ujian' | 'soal' | 'peserta' | 'pengawas' | 'ruang' | 'nilai';
type Bidang = { kode: string; nama: string };
type Ruang = { id: string; kode: string; nama: string; kapasitas: number };
type Seb = { id: string; nama: string; platform: string; aktif: boolean };
type Pengawas = { id: string; nama: string; username: string };
type Rujukan = { bidang: Bidang[]; ruang: Ruang[]; seb: Seb[]; pengawas: Pengawas[] };

const TABS: { id: Tab; label: string }[] = [
  { id: 'ujian', label: 'Ujian' },
  { id: 'soal', label: 'Soal' },
  { id: 'peserta', label: 'Peserta' },
  { id: 'pengawas', label: 'Pengawas' },
  { id: 'ruang', label: 'Ruang' },
  { id: 'nilai', label: 'Nilai Esai & Hasil' },
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
  const [tab, setTab] = useState<Tab>('ujian');
  const [rujukan, setRujukan] = useState<Rujukan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const muatRujukan = useCallback(() => {
    baca<Rujukan>('aksi=rujukan')
      .then(setRujukan)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    muatRujukan();
  }, [muatRujukan]);

  async function logout() {
    await post('/api/auth/logout');
    window.location.href = '/login';
  }

  function pilihTab(id: Tab) {
    setTab(id);
    setError(null);
    setInfo(null);
  }

  const judulTab = TABS.find((t) => t.id === tab)?.label ?? '';

  return (
    <AdminShell
      title="SuKaTryoutUP"
      subtitle="Panel Panitia"
      nav={TABS}
      active={tab}
      onSelect={pilihTab}
      onLogout={logout}
    >
      <div className="page-header">
        <div>
          <h1>{judulTab}</h1>
        </div>
      </div>

      {error && <div className="notice danger">{error}</div>}
      {info && <div className="notice neutral">{info}</div>}

      {!rujukan && !error && <div>Memuat…</div>}
      {rujukan && tab === 'ujian' && <UjianTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'soal' && <SoalTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'peserta' && <PesertaTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'pengawas' && <PengawasTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'ruang' && <RuangTab rujukan={rujukan} onRefresh={muatRujukan} setError={setError} setInfo={setInfo} />}
      {rujukan && tab === 'nilai' && <NilaiTab rujukan={rujukan} setError={setError} setInfo={setInfo} />}
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
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Peserta (termasuk impor CSV)
 * ------------------------------------------------------------------ */
function PesertaTab({ rujukan, setError, setInfo }: Props) {
  const [bidang, setBidang] = useState('');
  const [daftar, setDaftar] = useState<{ id: string; username: string; nama: string; bidang: string; status: string }[]>([]);
  const [form, setForm] = useState({ id: '', username: '', nama: '', bidang: '237', password: '', status: 'ACTIVE' });
  const [csv, setCsv] = useState('');

  const muat = useCallback(() => {
    baca<typeof daftar>(`aksi=peserta${bidang ? `&bidang=${bidang}` : ''}`).then(setDaftar).catch((e: Error) => setError(e.message));
  }, [bidang, setError]);

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

  async function imporCsv() {
    setError(null);
    try {
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-peserta', csv });
      setInfo(`${r.jumlah} peserta berhasil diimpor.`);
      setCsv('');
      muat();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <b>Daftar Peserta</b>
          <select value={bidang} onChange={(e) => setBidang(e.target.value)} style={{ marginLeft: 'auto', padding: 6 }}>
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
                  <td><button className="btn outline" onClick={() => setForm({ id: p.id, username: p.username, nama: p.nama, bidang: p.bidang, password: '', status: p.status })}>Ubah</button></td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={5}>Belum ada peserta.</td></tr>}
            </tbody>
          </table>
        </div>
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
        <h3>Impor Peserta (CSV)</h3>
        <div className="info" style={{ marginBottom: 8, fontSize: 13 }}>
          Format per baris: <code>username,nama,bidang,password</code>. Bidang berupa kode 3 digit, misalnya 237. Satu baris salah membatalkan seluruh impor.
        </div>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => setCsv(await e.target.files![0].text())} />
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} style={{ width: '100%', marginTop: 8, fontFamily: 'monospace' }} />
        <div style={{ marginTop: 8 }}><button className="btn" disabled={!csv.trim()} onClick={imporCsv}>Impor</button></div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Pengawas
 * ------------------------------------------------------------------ */
function PengawasTab({ rujukan, onRefresh, setError, setInfo }: Props & { onRefresh: () => void }) {
  const [form, setForm] = useState({ username: '', nama: '', password: '' });

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
  const [form, setForm] = useState({ id: '', kode: '', bidang: '237', tipe: 'PILIHAN_GANDA', isi: '', rubrik: '', status: 'PUBLISHED' });
  const [opsi, setOpsi] = useState<OpsiForm[]>(KOSONG_OPSI());

  const muat = useCallback(() => {
    const q = new URLSearchParams({ aksi: 'soal' });
    if (bidang) q.set('bidang', bidang);
    if (tipe) q.set('tipe', tipe);
    baca<typeof daftar>(q.toString()).then(setDaftar).catch((e: Error) => setError(e.message));
  }, [bidang, tipe, setError]);

  useEffect(() => { muat(); }, [muat]);

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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <select value={bidang} onChange={(e) => setBidang(e.target.value)} style={{ padding: 6 }}>
            <option value="">Semua Bidang Studi</option>
            {rujukan.bidang.map((b) => <option key={b.kode} value={b.kode}>{b.kode} – {b.nama}</option>)}
          </select>
          <select value={tipe} onChange={(e) => setTipe(e.target.value)} style={{ padding: 6 }}>
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
                <td style={{ maxWidth: 360 }}>{s.isi.slice(0, 90)}{s.isi.length > 90 ? '…' : ''}</td>
                <td>{s.status}</td>
                <td><button className="btn outline" onClick={() => ubah(s.id)}>Ubah</button></td>
              </tr>
            ))}
            {daftar.length === 0 && <tr><td colSpan={6}>Belum ada soal.</td></tr>}
          </tbody>
        </table>
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
        <textarea placeholder="Isi soal" value={form.isi} onChange={(e) => setForm({ ...form, isi: e.target.value })} rows={4} style={{ width: '100%', marginTop: 8 }} />

        {form.tipe === 'PILIHAN_GANDA' ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Opsi jawaban (pilih satu yang benar)</div>
            {opsi.map((o, i) => (
              <div key={o.label} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 20 }}>{o.label}</span>
                <input style={{ flex: 1 }} value={o.teks} onChange={(e) => setOpsi(opsi.map((x, j) => (j === i ? { ...x, teks: e.target.value } : x)))} />
                <label style={{ fontSize: 13 }}>
                  <input type="radio" name="benar" checked={o.benar} onChange={() => setOpsi(opsi.map((x, j) => ({ ...x, benar: j === i })))} /> benar
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <textarea placeholder="Rubrik penilaian (dipakai AI untuk memberi nilai 0–100)" value={form.rubrik} onChange={(e) => setForm({ ...form, rubrik: e.target.value })} rows={5} style={{ width: '100%' }} />
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [penugasan, setPenugasan] = useState<Record<string, string>>({});
  const [pengawasRuang, setPengawasRuang] = useState<Record<string, string[]>>({});

  const muatDaftar = useCallback(() => {
    baca<typeof daftar>('aksi=ujian').then(setDaftar).catch((e: Error) => setError(e.message));
  }, [setError]);
  useEffect(() => { muatDaftar(); }, [muatDaftar]);

  // Bank soal PUBLISHED sesuai Bidang Studi ujian yang sedang diedit.
  useEffect(() => {
    baca<typeof bankSoal>(`aksi=soal&bidang=${form.bidang}`)
      .then((r) => setBankSoal(r.filter((s: any) => s.status === 'PUBLISHED')))
      .catch(() => setBankSoal([]));
  }, [form.bidang]);

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
    setSebIds(d.seb);
    setPenugasan(Object.fromEntries(d.pesertaBidang.filter((p) => p.ruang_id).map((p) => [p.id, p.ruang_id as string])));
    setPengawasRuang(Object.fromEntries(d.ruang.map((r) => [r.id, r.pengawas])));
  }

  function baru() {
    setForm(KOSONG_UJIAN);
    setDetail(null);
    setSoalIds([]);
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
      setInfo('Penugasan disimpan. Token per ruang dibuat otomatis.');
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
  const pesertaRuang = (ruangId: string) => Object.values(penugasan).filter((r) => r === ruangId).length;

  return (
    <>
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
                <td><button className="btn outline" onClick={() => buka(u.id)}>Buka</button></td>
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

        <h3 style={{ marginTop: 14, fontSize: 15 }}>Soal (urutan sesuai centang)</h3>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d7dde6', borderRadius: 6, padding: 8 }}>
          {bankSoal.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: 8, fontSize: 14, marginBottom: 4 }}>
              <input type="checkbox" checked={soalIds.includes(s.id)} onChange={(e) => setSoalIds(e.target.checked ? [...soalIds, s.id] : soalIds.filter((x) => x !== s.id))} />
              <span>[{s.tipe === 'ESAI' ? 'Esai' : 'PG'}] {s.kode ? `${s.kode} – ` : ''}{s.isi.slice(0, 100)}</span>
            </label>
          ))}
          {bankSoal.length === 0 && <div style={{ fontSize: 13 }}>Belum ada soal PUBLISHED untuk Bidang Studi ini.</div>}
        </div>

        <h3 style={{ marginTop: 14, fontSize: 15 }}>Konfigurasi SEB</h3>
        {rujukan.seb.length === 0 && <div className="info" style={{ fontSize: 13 }}>Belum ada konfigurasi SEB. Tambahkan langsung di SQL Editor (tabel seb_konfigurasi).</div>}
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
            <div style={{ fontSize: 13, marginBottom: 8 }}>Pilih ruang untuk setiap peserta. Kosongkan jika belum ditempatkan.</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tabel">
                <thead><tr><th>Nama</th><th>Username</th><th>Ruang</th></tr></thead>
                <tbody>
                  {pesertaTersedia.map((p) => (
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
                  {pesertaTersedia.length === 0 && <tr><td colSpan={3}>Belum ada peserta aktif di Bidang Studi ini.</td></tr>}
                </tbody>
              </table>
            </div>
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

  async function imporNilai(file: File) {
    setError(null);
    try {
      const csv = await file.text();
      const r = await aksi<{ jumlah: number }>({ aksi: 'impor-esai', ujianId, csv, namaFile: file.name });
      setInfo(`${r.jumlah} nilai esai berhasil diimpor.`);
      muatHasil();
    } catch (e) { setError((e as Error).message); }
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
              <li>Unduh esai (berisi ID pengerjaan dan rubrik, tanpa nama peserta).</li>
              <li>Koreksi dengan AI menggunakan rubrik, lalu isi kolom <code>skor</code> (0–100) dan <code>umpan_balik</code>.</li>
              <li>Unggah kembali file hasil koreksi.</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <a className="btn outline" href={`/api/panitia?aksi=ekspor-esai&ujianId=${ujianId}`}>Unduh Esai (CSV)</a>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && imporNilai(e.target.files[0])} />
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Hasil</h3>
              <button className="btn hijau" onClick={publikasi}>Publikasikan Hasil</button>
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
