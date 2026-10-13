// Combines template definitions + built layouts into templates/dist/catalog.json
// (the single file the dashboard and engine import).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defsDir = join(root, 'templates', 'definitions');
const dist = join(root, 'templates', 'dist');
const templates = [];
const problems = [];
for (const f of readdirSync(defsDir).filter((n) => n.endsWith('.json')).sort()) {
  const def = JSON.parse(readFileSync(join(defsDir, f), 'utf8'));
  const layoutPath = join(dist, `${def.key}.layout.json`);
  if (!existsSync(layoutPath)) {
    problems.push(`${def.key}: not built`);
    continue;
  }
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
  if (layout.version !== def.version) problems.push(`${def.key}: layout v${layout.version} != definition v${def.version}`);
  for (const item of def.fields) if (!layout.slots[item.slot]) problems.push(`${def.key}: field uses unknown slot ${item.slot}`);
  // the sanitize section stays out of the browser bundle
  const { sanitize, slots, ...definition } = def;
  templates.push({ definition, layout });
}
writeFileSync(join(dist, 'catalog.json'), JSON.stringify({ templates }, null, 1));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`catalog.json: ${templates.length} templates`);
