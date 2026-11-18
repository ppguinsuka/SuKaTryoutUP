'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, ShieldCheck, Users, ClipboardCheck, ArrowRight } from 'lucide-react';
import { post } from '@/lib/client';
import '../admin-theme.css';

function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const { role } = await post<{ role: string }>('/api/auth/login', { username, password });
      if (role === 'PESERTA') router.replace('/peserta');
      else if (role === 'PENGAWAS') router.replace('/pengawas');
      else if (role === 'PANITIA' || role === 'SUPER_ADMIN') router.replace('/panitia');
      else setError('Peran akun tidak dikenali.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="login-page">
    <section className="login-brand-panel" aria-label="Tentang SuKa Tryout">
      <div className="login-brand-inner">
        <div className="login-brand-logo"><span className="brand-emblem"><img src="/suka-sungai.png" alt="Logo S SuKa Tryout" width="38" height="38" /></span><span>SuKa <b>Tryout</b></span></div>
        <span className="eyebrow light">PLATFORM TRYOUT TERPADU</span>
        <h1>Persiapan ujian,<br/>lebih terarah.</h1>
        <p>Sistem tryout UIN Sunan Kalijaga Yogyakarta untuk peserta, panitia, dan pengawas. Kelola jadwal, pengawasan, dan hasil ujian dengan lebih terstruktur.</p>
        <div className="login-features">
          <div><ClipboardCheck size={22}/><strong>Manajemen Ujian</strong><small>Pengaturan jadwal, soal, dan sesi tryout.</small></div>
          <div><Users size={22}/><strong>Ruang & Peserta</strong><small>Penugasan dan pemantauan ruang ujian.</small></div>
          <div><ShieldCheck size={22}/><strong>Akses Aman</strong><small>Login sesuai peran dan sesi terlindungi.</small></div>
        </div>
      </div>
    </section>
    <section className="login-form-panel">
      <div className="login-card">
        <span className="login-card-logo"><LockKeyhole size={21}/> Portal Pengguna</span>
        <h2>Selamat datang kembali</h2>
        <p>Masuk menggunakan akun yang diberikan oleh panitia.</p>
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Masukkan username" required maxLength={120}/>
          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input id="password" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Masukkan password" required maxLength={200}/>
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}>{showPw ? <EyeOff size={19}/> : <Eye size={19}/>}</button>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button primary" type="submit" disabled={loading}>{loading ? 'Sedang masuk…' : <>Masuk ke Akun <ArrowRight size={18}/></>}</button>
        </form>
        <p className="login-footnote">SuKa Tryout · UIN Sunan Kalijaga Yogyakarta</p>
      </div>
    </section>
  </div>;
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm/></Suspense>;
}
