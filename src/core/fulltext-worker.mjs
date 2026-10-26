/* Toledo+ — full-text extraction worker (a module Worker of the extension frame src/core/fulltext-host.html).
   Receives one file at a time: { id, bytes: ArrayBuffer (transferred), type } → posts { id, pages } | { id, skipped }.
   pdf.js (vendored, Apache-2.0) is imported lazily on the first PDF and runs inside this worker
   (globalThis.pdfjsWorker → pdf.js's in-thread "fake worker"): nothing heavy runs on the Toledo page's main thread.
   No network: the bytes come from the content script, the results go back to the frame. */
import './fulltext-engine.js';

const E = globalThis.TPFT;
let pdfjs = null;

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const [lib, worker] = await Promise.all([import('../vendor/pdfjs/pdf.min.mjs'), import('../vendor/pdfjs/pdf.worker.min.mjs')]);
  globalThis.pdfjsWorker = worker; // run the pdf.js "worker" part in this (already off-main-thread) worker
  try { lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href; } catch (_) { /* fake worker is used */ }
  pdfjs = lib;
  return pdfjs;
}

self.onmessage = async (ev) => {
  const { id, bytes, type } = ev.data || {};
  try {
    const opts = {};
    if (type === 'pdf') opts.pdfjs = await loadPdfjs();
    const r = await E.extract(new Uint8Array(bytes), type, opts);
    self.postMessage({ id, ...r });
  } catch (e) {
    self.postMessage({ id, skipped: 'unreadable', error: String((e && e.message) || e) });
  }
};
self.postMessage({ ready: true });
