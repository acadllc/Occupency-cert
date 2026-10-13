import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';

const links = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/projects', label: 'Projects', icon: '☰', end: true },
  { to: '/projects/new', label: 'New project', icon: '＋', end: true },
  { to: '/templates', label: 'Templates', icon: '❐', end: true },
  { to: '/settings', label: 'Account & security', icon: '⚙', end: true },
];

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6 10 58h10l12-29 12 29h10L32 6z" fill="#1f3a6e" />
      <path d="M20 44h24" stroke="#f28c38" strokeWidth="6" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, backend, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const signOut = async () => {
    await backend?.auth.signOut();
    await refresh();
    navigate('/login');
  };
  return (
    <div className="shell">
      <div className="mobile-bar">
        <strong>ACAD Documents</strong>
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="sidebar">
          Menu
        </button>
      </div>
      <nav id="sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Main">
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-name">
            ACAD
            <small>Document Generator</small>
          </span>
        </NavLink>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
            <span aria-hidden="true">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <div>Signed in as</div>
          <div style={{ color: '#fff', wordBreak: 'break-all' }}>{session?.email}</div>
          {backend?.mode === 'mock' && <div className="badge badge-warn" style={{ marginTop: 6 }}>Test mode – not connected to Supabase</div>}
          <button className="btn btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
