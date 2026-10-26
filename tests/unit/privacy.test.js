'use strict';
// The repo is public: fixtures and tests must contain only synthetic data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../helpers/sandbox');

const SCAN = ['tests', 'docs', 'src', 'README.md', 'README.en.md', 'AGENTS.md', 'CONTRIBUTING.md'];
const SKIP = new Set(['artifacts', 'node_modules']);
const EMAIL_OK = /@(example\.(edu|org|com|net|invalid|test)|users\.noreply\.github\.com|anthropic\.com)$/i;

function files() {
  const out = [];
  const walk = (p) => {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full)) return;
    const st = fs.statSync(full);
    if (st.isDirectory()) { for (const f of fs.readdirSync(full)) if (!SKIP.has(f)) walk(path.join(p, f)); } else if (/\.(js|json|md|html|ya?ml|css|mjs)$/.test(p)) out.push(p);
  };
  SCAN.forEach(walk);
  return out;
}

test('no real e-mail addresses', () => {
  const hits = [];
  for (const f of files()) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const e = m[0];
      if (EMAIL_OK.test(e)) continue;
      if (/^[a-z-]+@\d/.test(e) || /@(types|playwright|mermaid-js)\//.test(e)) continue; // npm scopes / versions
      if (/^(docent|student|teacher|prof)\.[a-z]@/i.test(e)) continue;
      hits.push(`${f}: ${e}`);
    }
  }
  assert.deepEqual(hits, [], `Possible real e-mail addresses (use @example.edu):\n${hits.join('\n')}`);
});

test('no student/staff numbers in fixtures', () => {
  const hits = [];
  for (const f of files().filter((x) => x.startsWith('tests'))) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\b[rRuU]\d{7}\b/g)) if (!/^[rRuU]0{7}$/.test(m[0])) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
});

test('fixture teachers are fictional', () => {
  const ultra = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/ultra.json'), 'utf8'));
  for (const list of Object.values(ultra.instructors)) {
    for (const i of list) {
      assert.equal(i.user.name.given, 'Docent');
      assert.match(i.user.contact.email, /@example\.edu$/);
    }
  }
  const portal = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/portal.json'), 'utf8'));
  const authors = new Set(portal.events.map((e) => e.author));
  for (const a of authors) assert.ok(/^(Docent [A-Z]|Studentenadministratie)$/.test(a), `author "${a}" should be fictional`);
});
