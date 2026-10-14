import { useEffect, useState } from 'react';
import { Confirm, Spinner, useToast } from '../components/ui';
import type { TotpEnrollment } from '../lib/auth';
import { company } from '../lib/config';
import { useSession } from '../lib/session';

export default function SettingsPage() {
  const { backend, session, refresh } = useSession();
  const toast = useToast();
  const [factors, setFactors] = useState<{ id: string; status: string; friendly_name?: string }[] | null>(null);
  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [remove, setRemove] = useState<string | null>(null);
  const [pw, setPw] = useState('');

  const load = () =>
    backend?.auth
      .factors()
      .then(setFactors)
      .catch((e: Error) => toast(e.message, 'error'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const verified = factors?.filter((f) => f.status === 'verified') ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Account &amp; security</h1>
          <p>Shared company account: {session?.email}</p>
        </div>
      </div>
      <section className="card card-pad stack">
        <h2>Two-step verification (recommended)</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Protect the shared account with an authenticator app (TOTP). Once enabled, every sign-in requires a code, and the database only accepts
          verified (two-step) sessions.
        </p>
        {!factors ? (
          <Spinner />
        ) : verified.length > 0 ? (
          <div className="stack">
            <div className="alert alert-ok">Two-step verification is enabled.</div>
            {verified.map((f) => (
              <div key={f.id} className="btn-row">
                <span>{f.friendly_name || 'Authenticator'}</span>
                <button className="btn btn-sm btn-danger" onClick={() => setRemove(f.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : enroll ? (
          <div className="stack">
            <p className="small">Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
            <img className="qr" alt="Authenticator QR code" width={180} height={180} src={enroll.qrSvg} />
            <div className="small">
              Or enter this key manually: <span className="mono">{enroll.secret}</span>
            </div>
            <div className="btn-row">
              <input className="input" style={{ maxWidth: 160 }} inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Verification code" />
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await backend!.auth.confirmTotp(enroll.factorId, code);
                    setEnroll(null);
                    setCode('');
                    toast('Two-step verification enabled', 'ok');
                    await load();
                    await refresh();
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                Verify &amp; enable
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              className="btn btn-primary"
              onClick={() =>
                backend!.auth
                  .enrollTotp()
                  .then(setEnroll)
                  .catch((e: Error) => toast(e.message, 'error'))
              }
            >
              Set up authenticator
            </button>
          </div>
        )}
      </section>
      <section className="card card-pad stack">
        <h2>Change password</h2>
        <div className="btn-row">
          <input className="input" style={{ maxWidth: 320 }} type="password" autoComplete="new-password" placeholder="New password (12+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
          <button
            className="btn"
            disabled={pw.length < 12}
            onClick={async () => {
              try {
                await backend!.auth.updatePassword(pw);
                setPw('');
                toast('Password changed', 'ok');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            Update password
          </button>
        </div>
      </section>
      <section className="card card-pad stack">
        <h2>About the shared account</h2>
        <p className="small muted" style={{ margin: 0 }}>
          All staff use one company login, so the history records which <em>account</em> generated a document, not which person. Keep the password in
          the company password manager, enable two-step verification and change the password when staff leave. Fixed company identity used in all
          documents: <strong>{company.consultant_name_en}</strong> / <span dir="rtl">{company.consultant_name_ar}</span>.
        </p>
      </section>
      {remove && (
        <Confirm
          title="Remove authenticator?"
          message="Sign-ins will no longer require a verification code."
          confirmLabel="Remove"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            const id = remove;
            setRemove(null);
            try {
              await backend!.auth.unenroll(id);
              toast('Authenticator removed', 'ok');
              await load();
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
