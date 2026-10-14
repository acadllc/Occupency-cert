import { useEffect, useRef, useState } from 'react';
import { stampChanged } from '../lib/engine';
import { useApi } from '../lib/session';
import { Confirm, Spinner, useToast } from './ui';

const MAX_WIDTH = 700;

/**
 * Turns the chosen image into a clean transparent PNG: a white background
 * (typical for scans/JPEGs) becomes transparent, empty borders are trimmed
 * and large images are scaled down.
 */
async function normalise(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot process images.');
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transparent++;
  if (transparent < px.length / 4 / 50) {
    // no real transparency: treat near-white as background
    for (let i = 0; i < px.length; i += 4) {
      const light = Math.min(px[i], px[i + 1], px[i + 2]);
      if (light > 235) px[i + 3] = 0;
      else if (light > 200) px[i + 3] = Math.round((px[i + 3] * (235 - light)) / 35);
    }
  }
  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (px[(y * canvas.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('The image looks empty.');
  ctx.putImageData(img, 0, 0);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const scale = Math.min(1, MAX_WIDTH / w);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the PNG.'))), 'image/png'));
}

/** Settings card for the company stamp + signature used on generated documents. */
export function StampSignatureSettings() {
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
      .getStampSignature()
      .then(show)
      .catch((e: Error) => {
        setUrl(null);
        toast(e.message, 'error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast('Please choose a PNG or JPG image.', 'error');
      return;
    }
    setBusy(true);
    try {
      const png = await normalise(file);
      await api.saveStampSignature(png);
      stampChanged();
      show(png);
      toast('Stamp and signature saved', 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="card card-pad stack">
      <h2>Stamp &amp; signature</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Used on official ACAD documents when <strong>Add the ACAD stamp &amp; signature</strong> is ticked while generating. It is placed on the
        consultant signature area, or beside the word «الاستشاري» where the document has no signature box. The image is kept in private storage
        (only this signed-in account can load it) and is never part of the public website.
      </p>
      {url === undefined ? (
        <Spinner />
      ) : url ? (
        <div className="stamp-preview">
          <img src={url} alt="Current stamp and signature" />
        </div>
      ) : (
        <div className="alert alert-warn">No stamp and signature uploaded yet — documents are generated without them.</div>
      )}
      <div className="btn-row">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Stamp and signature image" onChange={(e) => void upload(e.target.files?.[0])} />
        <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Saving…' : url ? 'Replace image' : 'Upload image'}
        </button>
        {url && (
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Best: a PNG with a transparent background (stamp with the signature over it). A scan on white paper also works — the white is removed
        automatically.
      </p>
      {confirmRemove && (
        <Confirm
          title="Remove the stamp and signature?"
          message="New documents will be generated without them. Documents generated earlier are not changed."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            try {
              await api.deleteStampSignature();
              stampChanged();
              show(null);
              toast('Stamp and signature removed', 'ok');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
    </section>
  );
}
