#!/usr/bin/env node
// Runs the staged Firefox build. Refresh the stage with `npm run pack:firefox`.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(ROOT, 'dist', 'firefox');
const profile = join(ROOT, '.dev-firefox-profile');

mkdirSync(profile, { recursive: true });

await webExt.cmd.run({
  sourceDir,
  target: ['firefox-desktop'],
  firefox: process.env.FIREFOX_BIN || 'firefox', // e.g. FIREFOX_BIN=/usr/bin/zen-browser
  firefoxProfile: profile,
  keepProfileChanges: true,
  startUrl: ['https://toledo.kuleuven.be/portal/'],
  ignoreFiles: ['_metadata'],
}, { shouldExitProgram: false });
