import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy as a <meta> tag (GitHub Pages cannot send headers).
 * connect-src is limited to the configured Supabase project.
 */
function csp(supabaseUrl: string | undefined): Plugin {
  let origin = '';
  try {
    origin = supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    origin = '';
  }
  const policy = [
    "default-src 'self'",
    `connect-src 'self' ${origin} ${origin.replace('https://', 'wss://')}`.trim(),
    `img-src 'self' data: blob: ${origin}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'acad-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// GitHub Pages serves the site from https://<owner>.github.io/<repo>/.
// VITE_BASE_PATH overrides the base (e.g. "/" for a custom domain).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: process.env.VITE_BASE_PATH ?? (mode === 'production' ? '/Occupency-cert/' : '/'),
    plugins: [react(), csp(env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)],
    server: { fs: { allow: ['../..'] } },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
    optimizeDeps: { exclude: ['harfbuzzjs'], esbuildOptions: { target: 'es2022' } },
  };
});
