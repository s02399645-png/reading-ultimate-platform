// Copies web/ to dist/ for deployment. Leaves out web/data (sample passages are for local mode only —
// in production passages are served by the Worker to signed-in users) and switches the app to API mode.
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'web'), dist, { recursive: true, filter: src => !src.includes(join('web', 'data')) });
writeFileSync(join(dist, 'config.js'), "window.APP_CONFIG = { MODE: 'api', API_BASE: '/api' };\n");
console.log('dist/ ready (no data/ folder, API mode on).');
