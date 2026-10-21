import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shims = {
  'next/link': resolve(root, 'artifact/next-link.tsx'),
  'next/navigation': resolve(root, 'artifact/next-navigation.ts'),
  '@/lib/useQuery': resolve(root, 'artifact/useQuery.ts'),
};
const shimPlugin = {
  name: 'shims',
  setup(b) {
    b.onResolve({ filter: /^(next\/link|next\/navigation|@\/lib\/useQuery)$/ }, (a) => ({ path: shims[a.path] }));
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, external: true }));
  },
};

const out = await build({
  entryPoints: [resolve(root, 'artifact/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  write: false,
  logLevel: 'warning',
  tsconfig: resolve(root, 'tsconfig.json'),
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_ARTIFACT': '"1"',
    // the single-file web build always runs in device mode (no server, no Supabase)
    'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""',
    'process.env.NEXT_PUBLIC_OFFLINE_GRACE_HOURS': '"72"',
  },
  plugins: [shimPlugin],
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8');
const html = `<title>NEAS Project Control</title>
<meta name="description" content="NextEdge Access Solutions project control: schedule, progress, BOQ, quotations, field reports and site evidence.">
<style>${css}</style>
<div id="neas-root"></div>
<script>${js}</script>
`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/neas-project-control.html'), html);
console.log('wrote dist/neas-project-control.html', (html.length / 1024).toFixed(0) + ' KB');
