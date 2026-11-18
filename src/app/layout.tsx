import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  icons: { icon: "/icon.png", apple: "/apple-touch-icon.png" },
  title: 'SuKa Tryout',
  description: 'Sistem Ujian dan Tryout SuKa' ,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
