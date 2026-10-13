import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Layout';
import { useSession } from '../lib/session';
import { company } from '../lib/config';

export default function LoginPage() {
  const { backend, session, refresh } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [notice, setNotice] = useState<string | null>(null);
  const needsMfa = Boolean(session?.needsMfa);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend) return;
    setBusy(true);
    setError(null);
    try {
      if (needsMfa) await backend.auth.verifyMfa(code);
      else await backend.auth.signIn(email, password);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend) return;
    setBusy(true);
    const redirect = `${window.location.origin}${window.location.pathname}#/reset-password`;
    await backend.auth.requestPasswordReset(email, redirect).catch(() => undefined);
    setBusy(false);
    setNotice('If this address belongs to the company account, a password reset link has been sent.');
  };

  return (
    <div className="login-wrap">
      <section className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">
            <Logo />
          </span>
          <span className="brand-name">
            ACAD
            <small>Engineering Consultants</small>
          </span>
        </div>
        <div>
          <h1>Occupancy &amp; completion documents, generated in minutes.</h1>
          <p>Enter each project once in Arabic and English, then produce every undertaking, letter and report as a ready-to-sign PDF.</p>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {company.consultant_name_en}
          <br />
          <span dir="rtl">{company.consultant_name_ar}</span>
        </p>
      </section>
      <section className="login-panel">
        <div className="card card-pad login-card stack">
          <div>
            <h1>{needsMfa ? 'Two-step verification' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</h1>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {needsMfa ? 'Enter the 6-digit code from your authenticator app.' : 'Company account access only.'}
            </p>
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          {notice && <div className="alert alert-info">{notice}</div>}
          {mode === 'forgot' && !needsMfa ? (
            <form className="stack" onSubmit={forgot}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={busy}>
                Send reset link
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('login')}>
                Back to sign in
              </button>
            </form>
          ) : (
            <form className="stack" onSubmit={submit}>
              {needsMfa ? (
                <div className="field">
                  <label htmlFor="code">Verification code</label>
                  <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="email">Email</label>
                    <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="password">Password</label>
                    <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </>
              )}
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Please wait…' : needsMfa ? 'Verify' : 'Sign in'}
              </button>
              {needsMfa ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    await backend?.auth.signOut();
                    await refresh();
                  }}
                >
                  Cancel
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('forgot')}>
                  Forgot password?
                </button>
              )}
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
