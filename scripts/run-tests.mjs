#!/usr/bin/env node
// Runs node:test files of one suite: `node scripts/run-tests.mjs unit|e2e [filter]`.
// (We list the files ourselves instead of relying on --test globs.)
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suite = process.argv[2] || 'unit';
const filter = process.argv[3] || '';
const dir = join(root, 'tests', suite);
const pattern = suite === 'e2e' ? /\.e2e\.js$/ : /\.test\.js$/;
const files = existsSync(dir) ? readdirSync(dir).filter((f) => pattern.test(f) && f.includes(filter)).sort().map((f) => join(dir, f)) : [];
if (!files.length) { console.error(`No ${suite} tests found in ${dir}`); process.exit(1); }
const args = ['--test', '--test-concurrency=1', ...(process.env.CI ? ['--test-reporter=spec'] : []), ...files];
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root, env: { ...process.env, TZ: 'Europe/Brussels' } });
process.exit(r.status ?? 1);
