'use client';

import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { post } from '@/lib/client';

const PAKTA = [
  'sanggup tidak menyebarkan dokumen soal baik berupa naskah maupun memfoto soal;',
  'sanggup tidak membuka sumber informasi saat ujian (buku, HP, komputer lain, google);',
  'sanggup mengerjakan ujian sendiri tanpa dilakukan oleh orang lain dan/atau dibantu orang lain;',
  'sanggup untuk tidak mengerjakan ujian peserta lain atau membantu mengerjakan ujian peserta lain;',
  'sanggup menaati tata tertib ujian, termasuk tidak melakukan pelanggaran/kecurangan selama ujian.',
];

export default function MulaiUjianPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params); // Next.js 15: params berupa Promise
  const [token, setToken] = useState('');
  const [setuju, setSetuju] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function mulai() {
    setError(null);
    setLoading(true);
    try {
      const { pengerjaanId } = await post<{ pengerjaanId: string }>(`/api/peserta/ujian/${id}/mulai`, {
        token: token.trim(),
      });
      router.replace(`/peserta/kerjakan/${pengerjaanId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <img src="/suka-sungai.png" alt="Logo SuKa Tryout" />
          <div>
            SuKa Tryout
            <div className="sub">Pernyataan Ujian</div>
          </div>
        </div>
        <a className="btn outline" href="/peserta">Kembali</a>
      </div>

      <div className="container" style={{ maxWidth: 720 }}>
        <div className="card">
          <h3>Pakta Integritas</h3>
          <p style={{ fontSize: 14 }}>Dengan ini menyatakan bahwa saya:</p>
          <ol style={{ fontSize: 14, lineHeight: 1.7 }}>
            {PAKTA.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
          <p style={{ fontSize: 13, color: '#555' }}>
            Apabila saya melanggar hal-hal di atas, saya bersedia dikenakan sanksi untuk tidak lulus.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} />
            Saya menyetujui pakta integritas di atas
          </label>
        </div>

        <div className="card">
          <h3>Token Ujian</h3>
          <div className="info" style={{ marginBottom: 10 }}>
            Masukkan token 6 karakter dari Pengawas atau Panitia. Token hanya diperlukan saat pertama kali membuka ujian.
          </div>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            maxLength={6}
            placeholder="6 karakter"
            autoComplete="off"
            style={{ padding: 10, fontSize: 18, letterSpacing: 4, width: 200, textTransform: 'uppercase', borderRadius: 6, border: '1px solid #ccd' }}
          />
        </div>

        {error && <div className="error">{error}</div>}
        <button className="btn hijau" disabled={!setuju || token.trim().length !== 6 || loading} onClick={mulai}>
          {loading ? 'Memproses…' : 'Setuju dan Mulai'}
        </button>
      </div>
    </>
  );
}
