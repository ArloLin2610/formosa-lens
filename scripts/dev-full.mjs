// One command for local development without the Netlify CLI: starts the local
// API server (scripts/dev-api.mjs) and Vite with /api proxied to it.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const apiPort = process.env.API_PORT ?? '8787';
const api = spawn(process.execPath, [resolve(here, 'dev-api.mjs')], { stdio: 'inherit', env: { ...process.env, API_PORT: apiPort } });
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, VITE_API_PROXY: `http://127.0.0.1:${apiPort}` },
});
const stop = () => { api.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', stop);
