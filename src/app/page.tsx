import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role === 'PESERTA') redirect('/peserta');
  if (user.role === 'PENGAWAS') redirect('/pengawas');
  redirect('/panitia');
}
