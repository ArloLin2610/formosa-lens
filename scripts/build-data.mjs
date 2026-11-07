// Bundles scripts/pipeline/build-data.ts with esbuild (it imports the TypeScript
// function modules) and runs it. Usage: npm run data:build
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), 'formosa-data-'));
await build({
  entryPoints: [resolve(here, 'pipeline/build-data.ts')],
  outfile: join(outDir, 'build-data.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await import(pathToFileURL(join(outDir, 'build-data.mjs')).href);
