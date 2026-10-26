#!/usr/bin/env node
// Packs the extension into dist/toledo-plus-<version>.zip (version from manifest.json).
// Uses the `zip` CLI when available, otherwise a small built-in zip writer (deflate via zlib).
// Usage: node scripts/pack.mjs [--out dir] [--node]   (--node forces the built-in writer)
// Only manifest-referenced files (+ LICENSE) are packed — see packFiles().
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Glob (only '*' within one path segment) → matching files, relative to root. */
function expand(root, pattern) {
  if (!pattern.includes('*')) return existsSync(join(root, pattern)) ? [pattern] : [];
  const dir = pattern.slice(0, pattern.lastIndexOf('/') + 1);
  const re = new RegExp('^' + pattern.slice(dir.length).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => re.test(f) && statSync(join(full, f)).isFile()).map((f) => dir + f);
}

/**
 * The files that go into the zip: manifest.json, every file the manifest references (service worker,
 * content scripts + css, web_accessible_resources incl. globs, icons, action icons, options/popup pages),
 * plus LICENSE. Nothing else (no tests, docs, legacy, dotfiles, stray files). Throws when a referenced file is missing.
 */
export function packFiles(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const refs = new Set(['manifest.json']);
  const add = (p) => { if (typeof p === 'string' && p) refs.add(p.replace(/^\.?\//, '')); };
  add(manifest.background && manifest.background.service_worker);
  for (const cs of manifest.content_scripts || []) { (cs.js || []).forEach(add); (cs.css || []).forEach(add); }
  Object.values(manifest.icons || {}).forEach(add);
  const action = manifest.action || {};
  Object.values(typeof action.default_icon === 'object' ? action.default_icon : { x: action.default_icon }).forEach(add);
  ((manifest.declarative_net_request || {}).rule_resources || []).forEach((r) => add(r.path));
  add(action.default_popup); add(manifest.options_page); add(manifest.options_ui && manifest.options_ui.page);
  const out = new Set();
  for (const r of refs) {
    if (!existsSync(join(root, r))) throw new Error(`manifest references a missing file: ${r}`);
    out.add(r);
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const pat of war.resources || []) {
      const hits = expand(root, pat.replace(/^\//, ''));
      if (!hits.length) throw new Error(`web_accessible_resources pattern matches nothing: ${pat}`);
      hits.forEach((h) => out.add(h));
    }
  }
  if (existsSync(join(root, 'LICENSE'))) out.add('LICENSE');
  return [...out].sort();
}

function main() {
  const argv = process.argv.slice(2);
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(ROOT, 'dist');
  const forceNode = argv.includes('--node');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const zipName = `toledo-plus-${manifest.version}.zip`;
  const files = packFiles(ROOT);
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, zipName);
  if (existsSync(target)) rmSync(target);
  const hasZip = !forceNode && spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0;
  if (hasZip) {
    const r = spawnSync('zip', ['-X', '-q', '-9', target, ...files], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
  } else {
    writeFileSync(target, buildZip(files));
  }
  console.log(`${relative(ROOT, target)}  (${files.length} files, ${(statSync(target).size / 1024).toFixed(1)} kB, ${hasZip ? 'zip' : 'node'})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// ---------- minimal zip writer ----------
function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function buildZip(list) {
  const locals = []; const centrals = []; let offset = 0;
  for (const rel of list) {
    const data = readFileSync(join(ROOT, rel));
    const comp = deflateRawSync(data, { level: 9 });
    const useDeflate = comp.length < data.length;
    const body = useDeflate ? comp : data;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(statSync(join(ROOT, rel)).mtime);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0o100644 << 16 >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
