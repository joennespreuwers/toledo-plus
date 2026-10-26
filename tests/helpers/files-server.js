'use strict';
// A real local HTTPS server that plays "S3" for signed download URLs.
//
// Why not just context.route()? Playwright does not intercept the follow-up request of a
// 3xx response produced by route.fulfill() — the browser sends it to the real network.
// Ultra's /attachments/{id}/download answers 302 → signed storage URL, so the mock does the
// same, and Chromium is pointed at this server via --host-resolver-rules
// (files.mock-storage.test → 127.0.0.1:<port>), with certificate errors ignored.
// Needs `openssl` to mint a throwaway certificate; without it, start() returns null and the
// mock serves downloads inline (no redirect).
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const HOST = 'files.mock-storage.test';
let certCache = null;

function cert() {
  if (certCache) return certCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-cert-'));
  const key = path.join(dir, 'key.pem'); const crt = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2',
    '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`], { stdio: 'ignore' });
  certCache = { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  fs.rmSync(dir, { recursive: true, force: true });
  return certCache;
}

/** @returns {Promise<null | { port, host, origin, chromeArgs, onRequest(fn), close() }>} */
async function start() {
  let tls;
  try { tls = cert(); } catch (_) { return null; }
  const listeners = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,OPTIONS' };
  const srv = https.createServer(tls, (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const u = new URL(req.url, `https://${HOST}`);
    const fileName = decodeURIComponent(u.pathname.split('/').pop() || 'file');
    for (const fn of listeners) fn({ url: `https://${HOST}${req.url}`, fileName, headers: req.headers, via: 'server' });
    res.writeHead(200, { ...cors, 'content-type': u.searchParams.get('type') || 'application/octet-stream' });
    res.end(require('./fixture-files').fileBody(fileName) || `MOCK FILE ${fileName}\n`); // real bytes for full-text tests
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return {
    port, host: HOST, origin: `https://${HOST}`,
    chromeArgs: [
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
      '--no-proxy-server', // everything else is mocked; never reach the real network
      '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests',
    ],
    onRequest(fn) { listeners.push(fn); },
    close() { return new Promise((r) => srv.close(() => r())); },
  };
}

module.exports = { start, HOST };
