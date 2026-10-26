'use strict';
// Tiny, synthetic course files generated in code (no binaries in the repo): a text PDF, a DOCX, a PPTX and an
// XLSX, used by the full-text unit tests and served by the e2e mock (tests/helpers/mock.js → fileBody()).
// All content is fictitious.
const zlib = require('zlib');

/** A minimal PDF (Helvetica, WinAnsi) with one text page per entry; each page: array of lines or a string. */
function makePdf(pages, { title } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'));
  const kids = [];
  for (const p of pages) {
    const lines = Array.isArray(p) ? p : [p];
    const esc = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c);
    const ops = ['BT', '/F1 12 Tf', '14 TL', '72 760 Td', ...lines.map((l, i) => (i ? 'T* ' : '') + `(${esc(l)}) Tj`), 'ET'].join('\n');
    const content = Buffer.from(ops, 'latin1');
    const stream = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`, 'latin1')));
  }
  objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, 'latin1');
  objs[pagesObj - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
  const info = title ? add(Buffer.from(`<< /Title (${title}) >>`, 'latin1')) : 0;
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let off = parts[0].length;
  const xref = [];
  objs.forEach((b, i) => {
    xref.push(off);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), b, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(chunk); off += chunk.length;
  });
  const xrefStart = off;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of xref) x += `${String(o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(x, 'latin1'));
  return Buffer.concat(parts);
}

/** A zip archive (deflate, or stored when opts.store) of {name: string|Buffer}. */
function makeZip(entries, opts = {}) {
  const local = []; const central = []; let off = 0;
  for (const [name, data] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const store = !!opts.store;
    const body = store ? raw : zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw) >>> 0;
    const n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(store ? 0 : 8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

/** DOCX with one <w:p> per paragraph (a paragraph may be an array of runs; "\f" = page break before). */
function makeDocx(paragraphs) {
  const body = paragraphs.map((p) => {
    const runs = (Array.isArray(p) ? p : [p]).map((r) => {
      const brk = r.startsWith('\f') ? '<w:r><w:br w:type="page"/></w:r>' : '';
      return `${brk}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEsc(r.replace(/^\f/, ''))}</w:t></w:r>`;
    }).join('');
    return `<w:p>${runs}</w:p>`;
  }).join('');
  return makeZip({
    '[Content_Types].xml': CT,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

/** PPTX: one slide per entry (array of text lines). Slides are written out of order to test sorting. */
function makePptx(slides) {
  const files = { '[Content_Types].xml': CT };
  slides.map((lines, i) => [i, lines]).reverse().forEach(([i, lines]) => {
    const sps = (Array.isArray(lines) ? lines : [lines]).map((l) => `<p:sp><p:txBody><a:p><a:r><a:t>${xmlEsc(l)}</a:t></a:r></a:p></p:txBody></p:sp>`).join('');
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${sps}</p:spTree></p:cSld></p:sld>`;
  });
  return makeZip(files);
}

/** XLSX: shared strings only (+ one sheet referencing them). */
function makeXlsx(strings) {
  return makeZip({
    '[Content_Types].xml': CT,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
  });
}

// ---- the files the e2e mock serves (by attachment file name; fictitious course content)
const FILES = {
  'filmtaal_les2.pdf': () => makePdf([
    ['Les 2 - Kadrering', 'Inleiding tot het beeldkader.'],
    ['Een totaalshot toont de ruimte.', 'Close-ups tonen emotie.'],
    ['De regel van derden helpt bij het kadreren van de kwartelkoning.', 'Let op de horizon en de kijkrichting.'],
  ]),
  'Regie_reader.pdf': () => makePdf([
    ['Regie reader', 'Hoofdstuk 1: de acteur.'],
    ['Hoofdstuk 2: mise-en-scène en blokkeren van de scène met de zonnewijzer.'],
  ]),
  'Draaiboek_sjabloon_Ooievaar.docx': () => makeDocx(['Draaiboek sjabloon', 'Scene 1: interieur, dag. De pelikaanlamp brandt.', '\fScene 2: exterieur, nacht.']),
  'Syllabus.pdf': () => makePdf([['Syllabus', 'Evaluatie: permanente evaluatie.']]),
};
const cache = new Map();
/** Bytes for an attachment file name, or null (→ the mock's "MOCK FILE" placeholder). */
function fileBody(fileName) {
  const f = FILES[fileName];
  if (!f) return null;
  if (!cache.has(fileName)) cache.set(fileName, f());
  return cache.get(fileName);
}

module.exports = { makePdf, makeZip, makeDocx, makePptx, makeXlsx, fileBody, FILES };
