'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { post } from '@/lib/client';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: 40 }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          {/* Ganti /logo-uin.png dengan file logo UIN Sunan Kalijaga Yogyakarta di folder public */}
          <img src="/logo-uin.png" alt="Logo UIN Sunan Kalijaga Yogyakarta" style={{ height: 80 }} />
          <h2 style={{ marginTop: 8 }}>SuKaTryoutUP</h2>
          <div style={{ fontSize: 13, color: '#666' }}>Silakan login dengan username dan password</div>
        </div>

        {params.get('info') === 'panitia' && (
          <div className="info" style={{ marginBottom: 10 }}>Halaman Panitia belum tersedia di versi ini.</div>
        )}

        <form onSubmit={submit}>
          <label style={{ fontSize: 14 }}>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            style={{ width: '100%', padding: 9, margin: '4px 0 12px', borderRadius: 6, border: '1px solid #ccd' }}
          />
          <label style={{ fontSize: 14 }}>Password</label>
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{ width: '100%', padding: 9, margin: '4px 0 6px', borderRadius: 6, border: '1px solid #ccd' }}
          />
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
            Tampilkan password
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Memproses…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
