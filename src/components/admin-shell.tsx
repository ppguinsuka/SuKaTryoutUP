'use client';

import { BarChart3, ClipboardList, FileQuestion, GraduationCap, LayoutDashboard, LogOut, Menu, MonitorCheck, ShieldCheck, Users, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export type NavItem<T extends string> = { id: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  title: string;
  subtitle: string;
  nav: NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  onLogout: () => void;
  userName?: string;
  children: ReactNode;
};

/** Ikon default per tab Panitia, supaya tampilannya sama dengan panel SuKa Olimpiade. */
export const IKON_PANITIA: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  ujian: ClipboardList,
  soal: FileQuestion,
  peserta: Users,
  pengawas: MonitorCheck,
  ruang: GraduationCap,
  nilai: BarChart3,
};

/** Layout panel admin: sidebar kiri, topbar, dan area konten (struktur sama dengan SuKa Olimpiade). */
export function AdminShell<T extends string>({ title, subtitle, nav, active, onSelect, onLogout, userName, children }: Props<T>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="admin-app">
      <aside className={open ? 'admin-sidebar open' : 'admin-sidebar'}>
        <div className="sidebar-brand tryout-brand">
          <span className="brand-emblem"><GraduationCap size={24}/></span>
          <span className="brand-copy"><strong>SuKaTryout<span>UP</span></strong><small>UIN SUNAN KALIJAGA</small></span>
        </div>
        <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Tutup menu"><X size={20} /></button>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon ?? IKON_PANITIA[item.id] ?? ClipboardList;
            return (
              <button
                key={item.id}
                type="button"
                className={item.id === active ? 'sidebar-link active' : 'sidebar-link'}
                onClick={() => { onSelect(item.id); setOpen(false); }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="admin-user">
            <span className="avatar-button">{(userName || 'P').charAt(0).toUpperCase()}</span>
            <div>
              <strong>{userName || 'Akun Panitia'}</strong>
              <small>{subtitle}</small>
            </div>
          </div>
          <button type="button" className="sidebar-link danger-link" onClick={onLogout}>
            <LogOut size={20} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>
      {open && <button aria-label="Tutup menu" className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <section className="admin-main">
        <header className="admin-topbar">
          <button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu size={22} /></button>
          <div>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="topbar-spacer" />
          <span className="api-mode"><ShieldCheck size={14}/> Panel Tryout</span>
        </header>
        <main className="admin-content">{children}</main>
      </section>
    </div>
  );
}
