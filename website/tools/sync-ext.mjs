// Copies the extension files the demo needs into website/demo/ext/ (gitignored).
// GitHub Pages does the same at build time (.github/workflows/pages.yml), so the extension is never duplicated in git.
//   node website/tools/sync-ext.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT_FILES = ['manifest.json', 'ui.css', 'page.css', 'src', 'icons', 'fonts'];

export function syncExt(dest = path.join(ROOT, 'website', 'demo', 'ext')) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of EXT_FILES) fs.cpSync(path.join(ROOT, f), path.join(dest, f), { recursive: true });
  return dest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('demo/ext ←', EXT_FILES.join(', '), '→', path.relative(ROOT, syncExt()));
}
