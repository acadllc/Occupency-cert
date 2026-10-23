import { useEffect, useRef, useState } from 'react';
import { stampChanged } from '../lib/engine';
import { normalisePhoto } from '../lib/files';
import { useApi } from '../lib/session';
import { Confirm, Spinner, useToast } from './ui';

/** Settings card for the designer engineer's licence card (Project Description form). */
export function EngineerLicenseSettings() {
  const api = useApi();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const show = (blob: Blob | null) =>
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return blob ? URL.createObjectURL(blob) : null;
    });

  useEffect(() => {
    api
      .getCompanyImage('engineer_license')
      .then(show)
      .catch((e: Error) => {
        setUrl(null);
        toast(e.message, 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      // re-encoded as JPEG (EXIF / location removed, at most 1800 px)
      const jpeg = await normalisePhoto(file);
      await api.saveCompanyImage('engineer_license', jpeg);
      stampChanged();
      show(jpeg);
      toast('Engineer licence card saved', 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="card card-pad stack">
      <h2>Engineer licence card</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Printed in the «Engineering License / قيد المهندس» box of the Project Description form (نموذج وصف المشروع والتعهدات), together with the
        designer engineer's name, registration number and phone. Like the stamp, it is kept in private storage and is never part of the public
        website.
      </p>
      {url === undefined ? (
        <Spinner />
      ) : url ? (
        <div className="stamp-preview">
          <img src={url} alt="Current engineer licence card" />
        </div>
      ) : (
        <div className="alert alert-warn">No licence card uploaded yet — the box stays empty.</div>
      )}
      <div className="btn-row">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Engineer licence card image" onChange={(e) => void upload(e.target.files?.[0])} />
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Saving…' : url ? 'Replace image' : 'Upload image'}
        </button>
        {url && (
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove
          </button>
        )}
      </div>
      {confirmRemove && (
        <Confirm
          title="Remove the engineer licence card?"
          message="New Project Description forms will be generated with an empty licence box. Documents generated earlier are not changed."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            try {
              await api.deleteCompanyImage('engineer_license');
              stampChanged();
              show(null);
              toast('Engineer licence card removed', 'ok');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
    </section>
  );
}
