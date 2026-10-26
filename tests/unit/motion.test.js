'use strict';
// TP.motion (src/core/motion.js): switches (tests flag, reduced motion), interrupt handling, FLIP, nesting.
// Runs in the vm sandbox with a tiny fake DOM: elements record the animations they were asked for.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');

class FakeAnimation {
  constructor(el, keyframes, opts) {
    this.el = el; this.keyframes = keyframes; this.opts = opts; this.cancelled = false; this.effect = { pseudoElement: opts.pseudoElement };
    this.finished = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.finished.catch(() => {});
    this._timer = setTimeout(() => this.finish(), (opts.duration || 0) + (opts.delay || 0)); // finishes like a real one
  }
  finish() { clearTimeout(this._timer); this._res(this); }
  cancel() { if (this.cancelled) return; clearTimeout(this._timer); this.cancelled = true; const e = new Error('AbortError'); e.name = 'AbortError'; this._rej(e); }
}

function fakeDom({ reduce = false, motionAttr = null, vt = false } = {}) {
  const anims = [];
  class Element {
    constructor(name = 'div', o = {}) {
      this.tagName = name.toUpperCase(); this.dataset = o.dataset || {}; this.children = []; this.parentElement = null;
      this.rect = o.rect || { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 };
      this.isConnected = true; this.attrs = {}; this.style = {}; this._classes = new Set(o.cls || []);
      this.classList = { contains: (c) => this._classes.has(c), add: (c) => this._classes.add(c), remove: (c) => this._classes.delete(c) };
      if (vt) this.startViewTransition = (fn) => { this.vtCalls = (this.vtCalls || 0) + 1; fn(); return { finished: Promise.resolve() }; };
    }
    animate(kf, opts) { const a = new FakeAnimation(this, kf, opts); anims.push(a); return a; }
    getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    append(...els) { for (const e of els) { e.parentElement = this; this.children.push(e); } return this; }
    querySelectorAll(sel) { if (/tp-ghost|tp-switch/.test(sel)) return []; const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out.filter((e) => e.dataset.q != null || e.dataset.flip != null); }
    querySelector() { return null; }
    contains(x) { for (let p = x; p; p = p.parentElement) if (p === this) return true; return false; }
  }
  const documentElement = new Element('html');
  if (motionAttr) documentElement.setAttribute('data-tp-motion', motionAttr);
  const globals = {
    Element,
    document: { documentElement },
    matchMedia: () => ({ matches: reduce }),
    CSS: { supports: () => true, escape: (s) => s },
    getComputedStyle: () => ({ position: 'relative', getPropertyValue: () => '' }),
    innerHeight: 800,
  };
  return { globals, anims, Element, documentElement };
}

function boot(o) {
  const dom = fakeDom(o);
  const s = sandbox({ globals: dom.globals });
  s.load('src/core/motion.js');
  return { M: s.TP.motion, ...dom };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('tokens mirror ui.css (120/200/280/350 ms, spring easing)', () => {
  const { M } = boot();
  assert.deepEqual({ ...M.DUR }, { 1: 120, 2: 200, 3: 280, 4: 350 });
  assert.match(M.EASE.spring, /^linear\(0, /);
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'ui.css'), 'utf8');
  for (const [k, v] of Object.entries({ 1: 120, 2: 200, 3: 280, 4: 350 })) assert.ok(css.includes(`--dur-${k}: ${v}ms`), `--dur-${k} in ui.css`);
  assert.ok(css.includes(M.EASE.spring), 'the same spring curve in ui.css');
});

test('motion off (<html data-tp-motion="off">): nothing animates, every helper still does its job synchronously', async () => {
  const { M, Element, anims } = boot({ motionAttr: 'off' });
  assert.equal(M.disabled, true);
  const el = new Element();
  assert.equal(M.enter(el), null);
  assert.equal(M.animate(el, [{ opacity: 0 }, { opacity: 1 }]), null);
  let done = 0;
  const p = M.leave(el, { onDone: () => done++ });
  assert.equal(done, 1, 'onDone runs synchronously');
  assert.equal(await p, true);
  let updated = 0;
  await M.transition(el, () => updated++, { direction: 'forward' });
  assert.equal(updated, 1);
  assert.equal(M.flip(el, () => 42), 42, 'flip returns mutate()');
  assert.deepEqual([...M.stagger([el])], []);
  assert.equal(anims.length, 0);
  // the explicit switch wins over the attribute, null follows the attribute again
  M.disabled = false; assert.equal(M.disabled, false); assert.ok(M.enter(el));
  M.disabled = null; assert.equal(M.disabled, true);
});

test('sync() marks a theme root for CSS', () => {
  const { M, Element } = boot({ motionAttr: 'off' });
  const root = new Element();
  M.sync(root); assert.equal(root.getAttribute('data-motion'), 'off');
  M.disabled = false; M.sync(root); assert.equal(root.getAttribute('data-motion'), 'on');
});

test('reduced motion: fades only, ≤ 120 ms, no stagger, no FLIP moves, no view transition', async () => {
  const { M, Element, anims } = boot({ reduce: true, vt: true });
  const el = new Element();
  const a = M.enter(el, { from: 'right', duration: 280, delay: 40 });
  assert.ok(a);
  assert.ok(a.keyframes.every((f) => Object.keys(f).every((k) => k === 'opacity')), 'opacity keyframes only');
  assert.ok(a.opts.duration <= 120);
  assert.equal(a.opts.delay, 0);
  assert.equal(M.animate(el, [{ translate: '8px 0' }, { translate: '0 0' }]), null, 'a move without opacity is dropped');
  assert.deepEqual([...M.stagger([new Element(), new Element()])], []);
  // FLIP: rows that move do not move
  const c = new Element();
  const r1 = new Element('div', { dataset: { q: 'a' }, rect: { left: 0, top: 0, width: 100, height: 20 } });
  c.append(r1);
  const n = anims.length;
  M.flip(c, () => { r1.rect = { left: 0, top: 60, width: 100, height: 20 }; });
  assert.equal(anims.filter((x, i) => i >= n && x.keyframes.some((f) => f.translate)).length, 0);
  // view transitions are skipped under reduced motion
  let ran = 0;
  await M.transition(el, () => ran++, { viewTransition: true });
  assert.equal(ran, 1);
  assert.equal(el.vtCalls || 0, 0);
});

test('interrupts: a new animation cancels the running one; enter() aborts a pending leave()', async () => {
  const { M, Element } = boot();
  const el = new Element();
  const a1 = M.enter(el);
  const a2 = M.enter(el);
  assert.equal(a1.cancelled, true, 'first enter cancelled');
  assert.equal(a2.cancelled, false);
  let done = 0;
  const p = M.leave(el, { onDone: () => done++ });
  assert.equal(M.leaving(el), true);
  assert.equal(a2.cancelled, true, 'leave cancels the enter');
  M.enter(el); // re-open while closing
  assert.equal(M.leaving(el), false);
  assert.equal(await p, false, 'the leave was aborted');
  assert.equal(done, 0, 'onDone not called: the element stays visible');
});

test('leave() finishes: onDone once, then its fill is dropped', async () => {
  const { M, Element, anims } = boot();
  const el = new Element();
  let done = 0;
  const p = M.leave(el, { onDone: () => done++ });
  const a = anims[anims.length - 1];
  assert.equal(a.opts.fill, 'forwards');
  a.finish();
  assert.equal(await p, true);
  assert.equal(done, 1);
  assert.equal(a.cancelled, true, 'animation removed after onDone (no lingering opacity:0)');
});

test('cancel() stops everything on an element', () => {
  const { M, Element } = boot();
  const el = new Element();
  const a = M.enter(el);
  M.cancel(el);
  assert.equal(a.cancelled, true);
});

test('transition(): updates first (input never waits), then slides the root in the navigation direction', async () => {
  const { M, Element } = boot();
  const root = new Element();
  let updatedBefore = false;
  const p = M.transition(root, () => { updatedBefore = true; }, { direction: 'forward' });
  assert.equal(updatedBefore, true, 'DOM updated synchronously');
  assert.ok(p && typeof p.then === 'function');
});

test('transition() directions map to slide offsets', () => {
  const { M, Element, anims } = boot();
  const seen = {};
  for (const d of ['forward', 'back', 'none']) {
    M.transition(new Element(), null, { direction: d });
    seen[d] = anims[anims.length - 1].keyframes[0].translate || null;
  }
  assert.equal(seen.forward, '8px 0px');
  assert.equal(seen.back, '-8px 0px');
  assert.equal(seen.none, null);
});

test('transition({viewTransition}) uses an element-scoped View Transition when the element has one', async () => {
  const { M, Element } = boot({ vt: true });
  const box = new Element();
  let ran = 0;
  await M.transition(box, () => ran++, { viewTransition: true });
  assert.equal(box.vtCalls, 1);
  assert.equal(ran, 1);
  const plain = boot().Element; // no startViewTransition → WAAPI path
  const b2 = new plain();
  await Promise.race([M.transition(b2, () => ran++, { viewTransition: true }), tick()]);
  assert.equal(ran, 2);
});

test('flip(): moved rows glide from their old place, new rows fade up (staggered), first paint does nothing', () => {
  const { M, Element, anims } = boot();
  const c = new Element();
  // first paint (no keyed rows before): no animation
  M.flip(c, () => { c.append(new Element('div', { dataset: { q: 'x' } })); });
  assert.equal(anims.length, 0);
  const a = new Element('div', { dataset: { q: 'alpha' }, rect: { left: 0, top: 0, width: 100, height: 20 } });
  const b = new Element('div', { dataset: { q: 'beta' }, rect: { left: 0, top: 20, width: 100, height: 20 } });
  c.children = []; c.append(a, b);
  const res = M.flip(c, () => {
    // re-render: new nodes, alpha now below beta, plus two new rows
    const a2 = new Element('div', { dataset: { q: 'alpha' }, rect: { left: 0, top: 20, width: 100, height: 20 } });
    const b2 = new Element('div', { dataset: { q: 'beta' }, rect: { left: 0, top: 0, width: 100, height: 20 } });
    const n1 = new Element('div', { dataset: { q: 'new1' }, rect: { left: 0, top: 40, width: 100, height: 20 } });
    const n2 = new Element('div', { dataset: { q: 'new2' }, rect: { left: 0, top: 60, width: 100, height: 20 } });
    c.children = []; c.append(a2, b2, n1, n2);
    return 'ok';
  });
  assert.equal(res, 'ok');
  const moves = anims.filter((x) => x.keyframes[0].translate && !('opacity' in x.keyframes[0]));
  assert.deepEqual(moves.map((x) => [x.el.dataset.q, x.keyframes[0].translate]).sort(), [['alpha', '0px -20px'], ['beta', '0px 20px']]);
  const fades = anims.filter((x) => 'opacity' in x.keyframes[0]);
  assert.deepEqual(fades.map((x) => x.el.dataset.q), ['new1', 'new2']);
  assert.deepEqual(fades.map((x) => x.opts.delay), [0, 20], '20 ms stagger');
});

test('flip(): a child moving with its parent is not animated twice', () => {
  const { M, Element, anims } = boot();
  const c = new Element();
  const sec = new Element('section', { dataset: { flip: 'sec' }, rect: { left: 0, top: 0, width: 100, height: 100 } });
  const row = new Element('div', { dataset: { q: 'row' }, rect: { left: 0, top: 10, width: 100, height: 20 } });
  sec.append(row); c.append(sec);
  M.flip(c, () => { sec.rect = { left: 0, top: 50, width: 100, height: 100 }; row.rect = { left: 0, top: 60, width: 100, height: 20 }; });
  assert.deepEqual(anims.map((a) => a.el.dataset.flip || a.el.dataset.q), ['sec']);
});

test('flip(): an interrupted flip cancels the running moves; nested flips only run the mutation', () => {
  const { M, Element, anims } = boot();
  const c = new Element();
  const a = new Element('div', { dataset: { q: 'a' }, rect: { left: 0, top: 0, width: 100, height: 20 } });
  c.append(a);
  M.flip(c, () => { a.rect = { left: 0, top: 40, width: 100, height: 20 }; });
  const first = anims[anims.length - 1];
  assert.equal(first.cancelled, false);
  M.flip(c, () => { a.rect = { left: 0, top: 80, width: 100, height: 20 }; });
  assert.equal(first.cancelled, true, 'the earlier move is cancelled before measuring again');
  const n = anims.length;
  let inner = 0;
  M.flip(c, () => { M.flip(c, () => { inner++; a.rect = { left: 0, top: 0, width: 100, height: 20 }; }); });
  assert.equal(inner, 1);
  assert.equal(anims.length - n, 1, 'only the outer flip animates');
});

test('flip() waits for an async mutation before measuring', async () => {
  const { M, Element, anims } = boot();
  const c = new Element();
  const a = new Element('div', { dataset: { q: 'a' }, rect: { left: 0, top: 0, width: 100, height: 20 } });
  c.append(a);
  const p = M.flip(c, async () => { await tick(); a.rect = { left: 0, top: 30, width: 100, height: 20 }; return 7; });
  assert.equal(anims.length, 0);
  assert.equal(await p, 7);
  assert.equal(anims.length, 1);
  assert.equal(anims[0].keyframes[0].translate, '0px -30px');
});

test('keys: data-flip > section > data-q; duplicates get a counter', () => {
  const { M, Element } = boot();
  assert.equal(M._keyOf(new Element('div', { dataset: { flip: 'x', q: 'y' } })), 'f:x');
  assert.equal(M._keyOf(new Element('section', { dataset: { section: 'ov-new' } })), 's:ov-new');
  assert.equal(M._keyOf(new Element('div', { dataset: { q: 'abc' } })), 'q:abc');
  assert.equal(M._keyOf(new Element('div', {})), null);
});

test('stagger(): ≤ 8 steps of 20 ms, rows below the fold are left alone', () => {
  const { M, Element } = boot();
  const rows = Array.from({ length: 12 }, (_, i) => new Element('div', { rect: { left: 0, top: i * 50, width: 100, height: 40 } }));
  rows.push(new Element('div', { rect: { left: 0, top: 5000, width: 100, height: 40 } }));
  const out = M.stagger(rows);
  assert.equal(out.length, 12);
  assert.deepEqual([...out].map((a) => a.opts.delay), [0, 20, 40, 60, 80, 100, 120, 140, 160, 160, 160, 160]);
  assert.ok(out.every((a) => a.opts.fill === 'backwards' || a.opts.delay === 0));
});
