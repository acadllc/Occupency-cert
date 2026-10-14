import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { EngineAssets } from '@acad/engine';

const require = createRequire(import.meta.url);

/** Filesystem asset loader used by tests and the QA generator. */
export function nodeAssets(root: string, images: Record<string, Uint8Array> = {}): EngineAssets {
  return {
    loadFont: async (file) => new Uint8Array(readFileSync(join(root, 'templates', 'fonts', file))),
    loadTemplate: async (key) => new Uint8Array(readFileSync(join(root, 'templates', 'dist', `${key}.pdf`))),
    loadSubsetWasm: async () => {
      return new Uint8Array(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
    },
    // the real stamp/signature is never committed; QA can use a private local copy in the git-ignored templates/.qa/
    loadStamp: async () => {
      const local = join(root, 'templates', '.qa', 'stamp-signature.png');
      return new Uint8Array(readFileSync(process.env.ACAD_LOCAL_STAMP === '1' && existsSync(local) ? local : join(root, 'tests', 'fixtures', 'test-stamp.png')));
    },
    loadDocxTemplate: async (key) => new Uint8Array(readFileSync(join(root, 'templates', 'dist', `${key}.docx`))),
    loadImage: async (path) => {
      const img = images[path];
      if (!img) throw new Error(`no test image for ${path}`);
      return img;
    },
  };
}
