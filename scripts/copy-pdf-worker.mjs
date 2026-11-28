import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerSource = resolve(
  projectRoot,
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
);
const workerTarget = resolve(projectRoot, 'public/pdf.worker.min.mjs');

await mkdir(dirname(workerTarget), { recursive: true });
await copyFile(workerSource, workerTarget);
console.log('Copied the PDF.js worker matching the installed pdfjs-dist package.');
