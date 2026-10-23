// npm run docs:vendor - copies the Swagger UI assets from node_modules into docs/assets/swagger (committed, so the
// Python-only documentation build and offline use need no CDN and no Node step).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'node_modules', 'swagger-ui-dist');
const dst = resolve(root, 'docs', 'assets', 'swagger');
mkdirSync(dst, { recursive: true });
for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE']) copyFileSync(resolve(src, f), resolve(dst, f));
const { version } = JSON.parse(readFileSync(resolve(src, 'package.json'), 'utf8'));
console.log(`Vendored swagger-ui-dist ${version} into docs/assets/swagger`);
