// Copies fonts and sanitized base PDFs into public/ (versioned file names for cache busting).
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const pub = join(here, '..', 'public');
for (const d of ['fonts', 'templates']) {
  rmSync(join(pub, d), { recursive: true, force: true });
  mkdirSync(join(pub, d), { recursive: true });
}
for (const f of readdirSync(join(root, 'templates', 'fonts'))) {
  if (f.endsWith('.ttf') || f.endsWith('.txt')) copyFileSync(join(root, 'templates', 'fonts', f), join(pub, 'fonts', f));
}
const catalog = JSON.parse(readFileSync(join(root, 'templates', 'dist', 'catalog.json'), 'utf8'));
for (const { definition, layout } of catalog.templates) {
  copyFileSync(join(root, 'templates', 'dist', `${definition.key}.pdf`), join(pub, 'templates', `${definition.key}.v${definition.version}.pdf`));
  if (layout.docx) copyFileSync(join(root, 'templates', 'dist', `${definition.key}.docx`), join(pub, 'templates', `${definition.key}.v${definition.version}.docx`));
}
console.log(`copied ${catalog.templates.length} templates and fonts to public/`);
