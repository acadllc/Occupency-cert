import { useEffect, useState } from 'react';
import type { FieldDef, PhotoEntry } from '@acad/engine';
import { normalisePhoto } from '../lib/files';
import { useApi } from '../lib/session';
import { useToast } from './ui';

interface Props {
  def: FieldDef;
  projectId: string | null;
  value: PhotoEntry[];
  onChange: (v: PhotoEntry[]) => void;
}

function Thumb({ path }: { path: string }) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    api
      .downloadPhoto(path)
      .then((b) => {
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [api, path]);
  return url ? <img src={url} alt="" /> : <div style={{ height: 150, background: '#eef1f6' }} />;
}

export function PhotosField({ def, projectId, value, onChange }: Props) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const max = def.maxItems ?? 14;
  const listId = `${def.key}-captions`;

  const add = async (files: FileList | null) => {
    if (!files || !projectId) return;
    setBusy(true);
    const next = [...value];
    for (const file of Array.from(files)) {
      if (next.length >= max) {
        toast(`A maximum of ${max} photos is supported.`, 'error');
        break;
      }
      try {
        const blob = await normalisePhoto(file);
        const path = `projects/${projectId}/photos/${crypto.randomUUID()}.jpg`;
        await api.uploadPhoto(path, blob);
        next.push({ path, details_ar: def.detailOptions?.[def.detailOptions.length - 1] ?? '', notes_ar: '' });
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
    onChange(next);
    setBusy(false);
  };

  const update = (i: number, patch: Partial<PhotoEntry>) => onChange(value.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // the stored file is deleted when the project is saved without it
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));

  return (
    <div className="field span-2">
      <div className="label">
        <span>
          {def.label} <span className="muted">({value.length}/{max})</span>
        </span>
      </div>
      {def.help && <span className="help">{def.help}</span>}
      {!projectId ? (
        <div className="alert alert-info">Save the project first, then add photos.</div>
      ) : (
        <>
          <datalist id={listId}>
            {def.detailOptions?.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <div className="photos">
            {value.map((p, i) => (
              <div className="photo" key={p.path}>
                <Thumb path={p.path} />
                <div className="body">
                  <div className="btn-row" style={{ justifyContent: 'space-between' }}>
                    <span className="badge">Photo {i + 1}</span>
                    <span className="btn-row">
                      <button type="button" className="btn btn-sm btn-ghost" aria-label="Move earlier" onClick={() => move(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label="Move later" onClick={() => move(i, 1)} disabled={i === value.length - 1}>
                        ↓
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(i)}>
                        Remove
                      </button>
                    </span>
                  </div>
                  <input className="input" dir="rtl" list={listId} placeholder="تفاصيل الصورة" aria-label={`Photo ${i + 1} details (Arabic)`} value={p.details_ar ?? ''} maxLength={80} onChange={(e) => update(i, { details_ar: e.target.value })} />
                  <input className="input" dir="rtl" placeholder="الملاحظات" aria-label={`Photo ${i + 1} notes (Arabic)`} value={p.notes_ar ?? ''} maxLength={120} onChange={(e) => update(i, { notes_ar: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <label className="btn" aria-disabled={busy || value.length >= max}>
              {busy ? 'Uploading…' : '＋ Add photos'}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy || value.length >= max} onChange={(e) => add(e.target.files).finally(() => (e.target.value = ''))} />
            </label>
            <span className="help" style={{ marginLeft: 8 }}>
              Photos are resized, stripped of location data and stored privately. Remember to save the project.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
