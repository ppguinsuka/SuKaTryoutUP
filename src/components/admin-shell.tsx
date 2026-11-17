'use client';

import type { ReactNode } from 'react';

export type NavItem<T extends string> = { id: T; label: string };

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

/** Layout panel admin: sidebar kiri, topbar, dan area konten (gaya SuKa Olimpiade). */
export function AdminShell<T extends string>({ title, subtitle, nav, active, onSelect, onLogout, userName, children }: Props<T>) {
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src="/logo-uin.png" alt="Logo UIN Sunan Kalijaga Yogyakarta" />
          <div>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </div>
        </div>
        <nav className="admin-nav">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === active ? 'admin-link active' : 'admin-link'}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="admin-footer">
          <div className="admin-user">
            <span className="admin-avatar">{(userName || 'A').charAt(0).toUpperCase()}</span>
            <div>
              <strong>{userName || 'Akun Admin'}</strong>
              <small>{subtitle}</small>
            </div>
          </div>
          <button type="button" className="admin-link danger" onClick={onLogout}>Keluar</button>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </section>
    </div>
  );
}
