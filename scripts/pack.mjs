#!/usr/bin/env node
// Packs the extension into dist/toledo-plus-<version>.zip (version from manifest.json).
// Uses the `zip` CLI when available, otherwise a small built-in zip writer (deflate via zlib).
// Usage: node scripts/pack.mjs [--out dir] [--node]   (--node forces the built-in writer)
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(root, 'dist');
const forceNode = argv.includes('--node');

const EXCLUDE_DIRS = new Set(['tests', 'docs', 'legacy', 'node_modules', '.github', 'scripts', 'dist', '.git', '.vscode', '.idea']);
const EXCLUDE_FILES = [/^\./, /\.md$/i, /^package(-lock)?\.json$/, /^LICENSE$/, /\.zip$/, /\.log$/, /\.pem$/];
const KEEP_ROOT_FILES = new Set(['LICENSE']); // ship the license inside the zip

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const zipName = `toledo-plus-${version}.zip`;

function collect(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    const st = statSync(full);
    const top = rel.split('/')[0];
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(top) || name.startsWith('.')) continue;
      collect(full, out);
    } else {
      const isRoot = !rel.includes('/');
      if (isRoot && KEEP_ROOT_FILES.has(name)) { out.push(rel); continue; }
      if (EXCLUDE_FILES.some((r) => r.test(name)) && (isRoot || name.startsWith('.'))) continue;
      out.push(rel);
    }
  }
  return out;
}

const files = collect(root);
if (!files.includes('manifest.json')) throw new Error('manifest.json missing');
mkdirSync(outDir, { recursive: true });
const target = join(outDir, zipName);
if (existsSync(target)) rmSync(target);

const hasZip = !forceNode && spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0;
if (hasZip) {
  const r = spawnSync('zip', ['-X', '-q', '-9', target, ...files], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
} else {
  writeFileSync(target, buildZip(files));
}
console.log(`${relative(root, target)}  (${files.length} files, ${(statSync(target).size / 1024).toFixed(1)} kB, ${hasZip ? 'zip' : 'node'})`);

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
    const data = readFileSync(join(root, rel));
    const comp = deflateRawSync(data, { level: 9 });
    const useDeflate = comp.length < data.length;
    const body = useDeflate ? comp : data;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(statSync(join(root, rel)).mtime);
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
