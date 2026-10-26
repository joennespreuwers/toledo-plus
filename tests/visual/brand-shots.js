'use strict';
// Brand review screenshots (v1.6): every view at 390 / 1440 / 2560, light + dark → tests/artifacts/brand/.
//   NODE_PATH=$(npm root -g) node tests/visual/brand-shots.js [view…]
// Not part of `npm test` (it only takes pictures); uses the e2e mocks, so the data is synthetic.
const fs = require('fs');
const path = require('path');
const { launch, waitForShell, waitForIdle, waitForQuiet, portalRoute, ARTIFACTS } = require('../helpers/launch');

const OUT = path.join(ARTIFACTS, 'brand');
const COURSE_URL = 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900661_1/outline';
const VIEWS = {
  welcome: { route: 'overview', welcome: true },
  overview: { route: 'overview' },
  courses: { route: 'courses' },
  course: { url: COURSE_URL },
  deadlines: { route: 'deadlines' },
  agenda: { route: 'agenda' },
  announcements: { route: 'announcements' },
  kuloket: { route: 'kuloket' },
  settings: { route: 'settings' },
};
const WIDTHS = [[390, 844], [1440, 900], [2560, 1440]];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  for (const scheme of ['light', 'dark']) {
    for (const [w, hgt] of WIDTHS) {
      const h = await launch({ colorScheme: scheme, viewport: { width: w, height: hgt } });
      try {
        for (const [name, v] of Object.entries(VIEWS)) {
          if (only.length && !only.includes(name)) continue;
          await h.setState({ ui: { onboarded: !v.welcome } });
          const page = h.page;
          await page.goto('about:blank');
          await page.goto(v.url || portalRoute(v.route));
          await waitForShell(page); await waitForIdle(page); await waitForQuiet(page);
          await page.waitForTimeout(v.url ? 900 : 300);
          await page.evaluate(() => document.fonts && document.fonts.ready);
          const file = path.join(OUT, `${name}-${scheme}-${w}.png`);
          await page.screenshot({ path: file });
          console.log(path.relative(process.cwd(), file));
        }
        if (h.errors.length) console.warn('errors:', h.errors.join('\n'));
      } finally { await h.close(); }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
