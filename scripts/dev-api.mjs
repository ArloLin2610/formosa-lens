// Local API server for development without the Netlify CLI. It bundles every
// function in netlify/functions with esbuild and serves them on one port using
// each function's exported `config.path`, the same way Netlify routes them.
//
//   node scripts/dev-api.mjs            # http://127.0.0.1:8787/api/*
//   VITE_API_PROXY=http://127.0.0.1:8787 npm run dev
import { createServer } from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const functionsDir = resolve(here, '../netlify/functions');
const port = Number(process.env.API_PORT ?? 8787);

const outDir = await mkdtemp(join(tmpdir(), 'formosa-api-'));
const entries = (await readdir(functionsDir)).filter((name) => /\.m?[jt]s$/.test(name) && !name.startsWith('_'));
await build({
  entryPoints: entries.map((name) => join(functionsDir, name)),
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

const routes = [];
for (const name of entries) {
  const module = await import(pathToFileURL(join(outDir, name.replace(/\.m?[jt]s$/, '.mjs'))).href);
  const path = module.config?.path;
  if (!path || typeof module.default !== 'function') continue; // scheduled functions have no path
  routes.push({ path, handler: module.default, name });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
  const route = routes.find((item) => item.path === url.pathname);
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'No function for ' + url.pathname, routes: routes.map((item) => item.path) }));
    return;
  }
  const started = Date.now();
  try {
    const response = await route.handler(new Request(url, { method: req.method, headers: req.headers }), {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${req.method} ${url.pathname}${url.search} -> ${response.status} (${Date.now() - started} ms)`);
  } catch (error) {
    console.error(`${route.name} crashed`, error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Function crashed' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Formosa Lens API on http://127.0.0.1:${port}`);
  for (const route of routes) console.log(`  ${route.path}  (${route.name})`);
});
