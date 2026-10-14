/**
 * Generates every catalog template with fabricated sample data and renders
 * PNG previews for visual QA:  npm run templates:qa  (or: npx tsx scripts/qa-generate.ts [keys...])
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Engine, type Catalog, type CompanyConfig, type FieldRegistry, type ProjectFields } from '@acad/engine';
import { longProject, sampleProject } from '../tests/fixtures/sample-projects';
import { nodeAssets } from '../tests/node-assets';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const registry = read('templates/fields.json') as FieldRegistry;
const company = read('templates/company.json') as CompanyConfig;
const catalog = read('templates/dist/catalog.json') as Catalog;

const only = process.argv.slice(2);
const out = join(root, 'templates', '.qa', 'out');
mkdirSync(out, { recursive: true });

const photos: Record<string, Uint8Array> = {};
for (const n of [1, 2, 3]) photos[`test/photo${n}.jpg`] = new Uint8Array(readFileSync(join(root, 'tests', 'fixtures', 'photos', `photo${n}.jpg`)));
const engine = await Engine.create(nodeAssets(root, photos), registry, company, catalog);
const variants: [string, ProjectFields][] = [
  ['sample', sampleProject],
  ['long', longProject],
  ['empty', {}],
];
for (const { definition } of catalog.templates) {
  if (only.length && !only.includes(definition.key)) continue;
  for (const [name, fields] of variants) {
    const res = await engine.generate(definition.key, fields, { stamp: name !== 'empty' });
    const file = join(out, `${definition.key}.${name}.pdf`);
    writeFileSync(file, res.bytes);
    execFileSync('pdftoppm', ['-r', '90', '-png', file, file.replace(/\.pdf$/, '')]);
    const warn = res.warnings.map((w) => `${w.code}:${w.slot}`).join(', ');
    console.log(`${definition.key.padEnd(34)} ${name.padEnd(6)} pages=${res.pageCount} ${(res.bytes.length / 1024).toFixed(0)}KB ${warn}`);
    if (name === 'sample' && engine.supportsDocx(definition.key)) {
      // Word output: write the .docx and render it through LibreOffice for a visual check
      const docx = await engine.generateDocx(definition.key, fields, { stamp: true });
      const dfile = join(out, `${definition.key}.sample.docx`);
      writeFileSync(dfile, docx.bytes);
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', join(out, 'docx'), dfile], { stdio: 'ignore', env: { ...process.env, FONTCONFIG_FILE: join(root, 'scripts/templates/fonts.conf') } });
      const pdf = join(out, 'docx', `${definition.key}.sample.pdf`);
      execFileSync('pdftoppm', ['-r', '70', '-png', pdf, pdf.replace(/\.pdf$/, '')]);
      console.log(`${definition.key.padEnd(34)} docx   ${(docx.bytes.length / 1024).toFixed(0)}KB filled=${docx.placements.length}`);
    }
  }
}
