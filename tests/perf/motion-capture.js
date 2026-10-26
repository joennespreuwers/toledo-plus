'use strict';
// Motion capture + perf check (not part of `npm test`):
//   NODE_PATH=$(npm root -g) node tests/perf/motion-capture.js [--no-video] [--no-perf]
// 1. Videos (tests/artifacts/motion/<scenario>-{before,after}.webm): "before" = motion off (the e2e default, no
//    animations — how the app behaved before v1.5), "after" = motion on.
// 2. Perf with 4× CPU throttling (CDP Emulation.setCPUThrottlingRate): per scenario, frame intervals from a rAF loop
//    and long tasks (PerformanceObserver), motion off vs on → tests/artifacts/motion/perf.json + a table.
const fs = require('fs');
const path = require('path');
const { launch, waitForShell, waitForIdle, waitForQuiet, ARTIFACTS, COURSE_URL } = require('../helpers/launch');
const { S, openPortal, waitForRoute } = require('../helpers/app');

const OUT = path.join(ARTIFACTS, 'motion');
const VIEW = { width: 1280, height: 800 };
const args = new Set(process.argv.slice(2));
const pause = (page, ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- scenarios (each runs on an open shell page)
const SCENARIOS = {
  async 'navigate-course-back'(h) {
    const page = h.page;
    await openPortal(h, 'overview');
    await pause(page, 400);
    await page.locator(S.navLink('courses')).click();
    await waitForRoute(page, 'courses');
    await pause(page, 500);
    const link = page.locator('#tplus-root main a[href*="batchUid=ULTRA-B-LUCA-X10265-2627"]').first();
    await link.hover();
    await pause(page, 400); // rests on the link: id resolved, link goes straight to the outline
    await Promise.all([page.waitForURL(/\/ultra\/courses\/_900661_1\/outline/), page.locator('#tplus-root main a[href*="_900661_1/outline"], #tplus-root main a[href*="batchUid=ULTRA-B-LUCA-X10265-2627"]').first().click()]);
    await waitForShell(page);
    await pause(page, 1200);
    await page.goBack();
    await waitForShell(page);
    await pause(page, 800);
  },
  async 'palette'(h) {
    const page = h.page;
    await openPortal(h, 'overview');
    await pause(page, 400);
    await page.keyboard.press('Control+k');
    await pause(page, 500);
    await page.keyboard.type('regie', { delay: 60 });
    await pause(page, 600);
    await page.keyboard.press('Escape');
    await pause(page, 600);
  },
  async 'filter-courses'(h) {
    const page = h.page;
    await openPortal(h, 'courses');
    await pause(page, 400);
    await page.locator(S.search).click();
    await page.keyboard.type('film', { delay: 120 });
    await pause(page, 700);
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Backspace'); await pause(page, 120); }
    await pause(page, 700);
    await page.locator('#tplus-root .cs-bar .tp-seg:nth-child(2)').click();
    await pause(page, 600);
    await page.locator('#tplus-root .cs-bar .tp-seg:nth-child(1)').click();
    await pause(page, 700);
  },
  async 'expand-folder'(h) {
    const page = h.page;
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitForIdle(page); await waitForQuiet(page);
    await pause(page, 400);
    const closed = page.locator('#tplus-root details.cv-folder:not([open]) > summary').first();
    await closed.click();
    await pause(page, 700);
    await closed.click();
    await pause(page, 700);
  },
  async 'deadline-sheet'(h) {
    const page = h.page;
    await openPortal(h, 'deadlines');
    await pause(page, 400);
    await page.locator('#tplus-root [data-action="va-dl-open"]').first().click();
    await pause(page, 900);
    await page.keyboard.press('Escape');
    await pause(page, 700);
  },
};

// ---------------------------------------------------------------- videos
async function videos() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, run] of Object.entries(SCENARIOS)) {
    for (const [label, motion] of [['before', false], ['after', true]]) {
      const dir = fs.mkdtempSync(path.join(OUT, '.tmp-'));
      const h = await launch({ motion, viewport: VIEW, recordVideo: { dir, size: VIEW } });
      // the persistent context's first page was opened before recording settings applied → use a fresh one
      const first = h.page;
      await h.newPage();
      await first.close().catch(() => {});
      try { await run(h); } catch (e) { console.warn(`[${name}/${label}]`, e.message); }
      const video = h.page.video();
      await h.close();
      const src = video ? await video.path().catch(() => null) : null;
      const dst = path.join(OUT, `${name}-${label}.webm`);
      if (src && fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log('video', path.relative(process.cwd(), dst)); }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------- perf (4× CPU throttling)
const PROBE = () => {
  const P = (window.__tpPerf = { frames: [], long: [] });
  let last = performance.now();
  const loop = (t) => { P.frames.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch (_) { /* unsupported */ }
};
async function perfRun(name, motion) {
  const h = await launch({ motion, viewport: VIEW });
  await h.ctx.addInitScript(PROBE);
  const cdp = await h.ctx.newCDPSession(h.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const stats = { frames: [], long: [] };
  const page = h.page;
  // collect per document (navigations reset the probe)
  const harvest = async () => {
    const p = await page.evaluate(() => { const P = window.__tpPerf || { frames: [], long: [] }; const out = { frames: P.frames.slice(1), long: P.long.slice() }; P.frames.length = 0; P.long.length = 0; return out; }).catch(() => ({ frames: [], long: [] }));
    stats.frames.push(...p.frames); stats.long.push(...p.long);
  };
  const origGoto = page.goto.bind(page);
  page.goto = async (...a) => { await harvest(); const r = await origGoto(...a); await harvest(); return r; }; // drop load-time frames
  try { await SCENARIOS[name](h); } catch (e) { console.warn(`[perf ${name}/${motion ? 'on' : 'off'}]`, e.message); }
  await harvest();
  await h.close();
  const f = stats.frames.filter((x) => x > 0 && x < 1000).sort((a, b) => a - b);
  const pct = (q) => (f.length ? f[Math.min(f.length - 1, Math.floor(q * f.length))] : 0);
  return {
    frames: f.length,
    p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), max: +(f[f.length - 1] || 0).toFixed(1),
    janky: f.filter((x) => x > 34).length, // ≥ 2 missed frames at 60 Hz
    longTasks: stats.long.length, longTaskMs: Math.round(stats.long.reduce((a, b) => a + b, 0)),
  };
}
async function perf() {
  fs.mkdirSync(OUT, { recursive: true });
  const res = {};
  const only = [...args].find((a) => a.startsWith('--only='))?.slice(7);
  for (const name of Object.keys(SCENARIOS).filter((n) => !only || n === only)) {
    res[name] = { off: await perfRun(name, false), on: await perfRun(name, true) };
    console.log(name, JSON.stringify(res[name]));
  }
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ cpuThrottling: 4, viewport: VIEW, at: new Date().toISOString(), res }, null, 2));
  console.log('\nscenario               | motion | frames | p50 ms | p95 ms | >34ms | long tasks (ms)');
  for (const [n, r] of Object.entries(res)) {
    for (const k of ['off', 'on']) {
      const x = r[k];
      console.log(`${n.padEnd(22)} | ${k.padEnd(6)} | ${String(x.frames).padStart(6)} | ${String(x.p50).padStart(6)} | ${String(x.p95).padStart(6)} | ${String(x.janky).padStart(5)} | ${x.longTasks} (${x.longTaskMs})`);
    }
  }
}

(async () => {
  if (!args.has('--no-video')) await videos();
  if (!args.has('--no-perf')) await perf();
})().catch((e) => { console.error(e); process.exit(1); });
