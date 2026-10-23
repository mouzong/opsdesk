// npm run api:spec - regenerates docs/api/openapi.json and docs/api/coverage.md from the route definitions.
// The files are committed so the (Python-only) documentation build and CI need no Node step; a test fails when they are stale.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApi } from '../api/openapi.js';
import { coverageMarkdown } from '../api/coverage.js';

const root = resolve(import.meta.dirname, '..', '..');
const dir = resolve(root, 'docs', 'api');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
writeFileSync(resolve(dir, 'coverage.md'), coverageMarkdown());
console.log('Wrote docs/api/openapi.json and docs/api/coverage.md');
