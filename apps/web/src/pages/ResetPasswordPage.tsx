import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';

export default function ResetPasswordPage() {
  const { backend, session, refresh } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await backend!.auth.updatePassword(password);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card card-pad stack" style={{ width: 'min(420px, 100%)' }} onSubmit={submit}>
        <h1>Choose a new password</h1>
        {!session && <div className="alert alert-warn">Open this page from the reset link in the email. The link expires after a short time.</div>}
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="field">
          <label htmlFor="np">New password</label>
          <input id="np" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cp">Confirm password</label>
          <input id="cp" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy || !session}>
          Save password
        </button>
      </form>
    </div>
  );
}
