'use strict';
// Resolve Playwright: local devDependency first (CI), then a global install (dev boxes without node_modules).
const path = require('path');
const { execSync } = require('child_process');

function load() {
  try { return require('playwright'); } catch (_) { /* fall through */ }
  const roots = [];
  if (process.env.NODE_PATH) roots.push(...process.env.NODE_PATH.split(path.delimiter));
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* no npm */ }
  for (const r of roots) {
    try { return require(path.join(r, 'playwright')); } catch (_) { /* next */ }
  }
  throw new Error('Playwright not found. Run `npm install` (devDependency) or install it globally, then `npx playwright install chromium`.');
}

module.exports = load();
