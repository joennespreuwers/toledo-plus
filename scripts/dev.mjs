#!/usr/bin/env node
// Runs the extension in Chrome with live reload: every saved file reloads the extension and its tabs.
// Uses a persistent profile in .dev-profile/ (gitignored) so the KU Leuven login survives restarts.
// Usage: npm run dev [-- --chrome /path/to/chrome]   (default: Chrome found by chrome-launcher)
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = join(ROOT, '.dev-profile');

const argv = process.argv.slice(2);
const chromiumBinary = argv.includes('--chrome') ? argv[argv.indexOf('--chrome') + 1] : undefined;

mkdirSync(PROFILE, { recursive: true });

await webExt.cmd.run({
  sourceDir: ROOT,
  target: ['chromium'],
  chromiumBinary,
  chromiumProfile: PROFILE,
  keepProfileChanges: true,
  startUrl: ['https://toledo.kuleuven.be/portal/'],
  // Not part of the extension: don't reload when these change. _metadata/ is written by Chrome itself when it loads the
  // declarativeNetRequest rules; watching it reloads the extension, which rewrites it, which reloads it… (endless loop).
  ignoreFiles: ['website', 'tests', 'docs', 'legacy', 'worker', 'scripts', 'dist', 'test-results', '*.md', 'package*.json', '.dev-profile', '_metadata']
    .flatMap((p) => [p, `${p}/**`]),
}, { shouldExitProgram: false });
