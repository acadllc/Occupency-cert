/** File naming, hashing, downloads and photo normalisation helpers. */

export function safeSegment(s: string, fallback = 'project'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return out || fallback;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** PROJECTID_template-key_YYYYMMDD-HHMMSS_r<revision>.<pdf|docx> (path-safe) */
export function documentFileName(projectId: string | undefined, templateKey: string, revision: number, when = new Date(), ext: 'pdf' | 'docx' = 'pdf'): string {
  return `${safeSegment(projectId ?? '', 'project')}_${templateKey}_${stamp(when)}_r${revision}.${ext}`;
}

/**
 * Name a generated document is downloaded under: the name of the original file it was made from
 * (e.g. «01Mechanical systemتعهد بالالتزام ….pdf»), so the files sort like the office's own folders.
 * Stored copies keep their path-safe names.
 */
export function downloadName(definition: { source: string; fileName?: string; key: string } | undefined, fallback: string, ext: 'pdf' | 'docx'): string {
  if (!definition) return fallback;
  const base = (definition.fileName ?? definition.source.split('/').pop() ?? definition.key)
    .replace(/(\.(pdf|docx))+$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return `${base || definition.key}.${ext}`;
}

export function storagePath(projectUuid: string, templateKey: string, fileName: string) {
  return `projects/${projectUuid}/${templateKey}/${fileName}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function zipFiles(files: { name: string; data: Uint8Array | Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let i = 2; used.has(name); i++) name = f.name.replace(/\.(pdf|docx)$/, `-${i}.$1`);
    used.add(name);
    zip.file(name, f.data);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Re-encode an uploaded photo as JPEG (max 1800 px, EXIF/location stripped by
 * the canvas round-trip). Only JPEG/PNG/WebP/HEIC-as-browser-decodable input.
 */
export async function normalisePhoto(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error('Please choose an image file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('The image is larger than 25 MB.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image format cannot be read by the browser. Use JPEG or PNG.');
  });
  const max = 1800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Image processing failed.');
  return blob;
}

export function formatBytes(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
