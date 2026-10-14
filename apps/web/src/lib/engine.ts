import { Engine } from '@acad/engine';
import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import { assetUrl, catalog, company, registry } from './config';
import { getBackend } from './backend';

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load ${url.split('/').pop()} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

let engine: Promise<Engine> | null = null;

/** Browser PDF engine (HarfBuzz shaping + pdf-lib); loaded lazily on first use. */
export function getEngine(): Promise<Engine> {
  if (!engine) {
    engine = Engine.create(
      {
        loadFont: (file) => fetchBytes(assetUrl(`fonts/${file}`)),
        loadTemplate: (key, version) => fetchBytes(assetUrl(`templates/${key}.v${version}.pdf`)),
        loadSubsetWasm: () => fetchBytes(subsetWasmUrl),
        loadImage: async (path) => {
          const { api } = await getBackend();
          return new Uint8Array(await (await api.downloadPhoto(path)).arrayBuffer());
        },
      },
      registry,
      company,
      catalog,
    ).catch((err) => {
      engine = null;
      throw err;
    });
  }
  return engine;
}
