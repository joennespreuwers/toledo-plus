/* Toledo+ — TP.motion: the motion system (v1.5). Native APIs only: Web Animations (WAAPI) for everything that
   JS starts, CSS transitions / @starting-style / ::details-content for what CSS can do on its own, and an
   element-scoped View Transition as an opt-in for small, bounded swaps. No library (see docs/DESIGN.md › Motion).

   Rules every helper follows:
   - only opacity / transform (`translate`, `scale`) are animated, except expand/collapse (height, short);
   - never blocks input (no overlays, no awaiting before the DOM changes: the DOM is updated first, then animated);
   - interruptible: a new animation on an element cancels the running one and starts from where it visually is;
   - prefers-reduced-motion → fades only, ≤ 120 ms; TP.motion.disabled (tests) → everything is instant.
   Tests switch motion off with <html data-tp-motion="off"> (tests/helpers/launch.js) or TP.motion.disabled = true. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  // ---------------------------------------------------------------- tokens (mirror ui.css)
  const DUR = { 1: 120, 2: 200, 3: 280, 4: 350 };
  // Apple-like curves: ease = decelerating standard curve; spring = damped spring (ζ≈0.72, ~4 % overshoot) for
  // controls (switch thumb, segmented pill, tab indicator); smooth = near-critically damped spring for moves/sheets.
  const SPRING = 'linear(0, 0.054, 0.181, 0.338, 0.498, 0.644, 0.766, 0.862, 0.933, 0.982, 1.013, 1.03, 1.037, 1.038, 1.035, 1.029, 1.023, 1.017, 1.012, 1.007, 1.004, 1.002, 1, 0.999, 1)';
  const SMOOTH = 'linear(0, 0.059, 0.187, 0.336, 0.481, 0.608, 0.713, 0.796, 0.859, 0.905, 0.938, 0.961, 0.977, 0.987, 0.994, 0.998, 1, 1.001, 1)';
  const supports = (prop, val) => { try { return !!(globalThis.CSS && CSS.supports(prop, val)); } catch (_) { return false; } };
  const hasLinear = supports('transition-timing-function', 'linear(0, 1)');
  const EASE = {
    standard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    spring: hasLinear ? SPRING : 'cubic-bezier(0.34, 1.3, 0.64, 1)',
    smooth: hasLinear ? SMOOTH : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  };
  const SHIFT = 8; // px: route slide distance

  // ---------------------------------------------------------------- switches
  let forced = null; // explicit TP.motion.disabled (true/false); null = follow <html data-tp-motion>
  const docOff = () => {
    try { return globalThis.document?.documentElement?.getAttribute('data-tp-motion') === 'off'; } catch (_) { return false; }
  };
  const isDisabled = () => (forced != null ? forced : docOff());
  const canAnimate = () => typeof globalThis.Element === 'function' && typeof Element.prototype.animate === 'function';
  let mq = null;
  function reduced() {
    try {
      if (!mq && globalThis.matchMedia) mq = matchMedia('(prefers-reduced-motion: reduce)');
      return !!(mq && mq.matches);
    } catch (_) { return false; }
  }
  /** true when nothing should move at all (tests, no WAAPI). */
  const off = () => isDisabled() || !canAnimate();

  /** Mark a theme root (shell app, deep bar) so CSS can switch its own transitions off too. */
  function sync(el) {
    if (!el || !el.setAttribute) return;
    const v = isDisabled() ? 'off' : 'on';
    if (el.getAttribute('data-motion') !== v) el.setAttribute('data-motion', v);
  }

  // ---------------------------------------------------------------- core animate()
  const running = new WeakMap(); // el → Set<Animation> started by TP.motion
  function track(el, a) {
    let s = running.get(el);
    if (!s) { s = new Set(); running.set(el, s); }
    s.add(a);
    const done = () => s.delete(a);
    a.finished.then(done, done);
    return a;
  }
  /** Cancel TP.motion animations on el (and pending leave()s, which then don't call their onDone). */
  function cancel(el) {
    const s = el && running.get(el);
    if (s) { for (const a of [...s]) { try { a.cancel(); } catch (_) { /* gone */ } } s.clear(); }
    if (el && el.__tpLeave) el.__tpLeave = null;
  }
  const isOpacityOnly = (kf) => (Array.isArray(kf) ? kf : [kf]).every((f) => Object.keys(f).every((k) => k === 'opacity' || k === 'offset' || k === 'easing'));
  /**
   * el.animate() with the house rules. Returns the Animation, or null when motion is off (then the end state
   * is simply the element's own style). Reduced motion keeps only opacity keyframes, ≤ 120 ms.
   */
  function animate(el, keyframes, o = {}) {
    if (!el || off() || !el.isConnected) return null;
    let kf = keyframes;
    let duration = o.duration ?? DUR[2];
    let delay = o.delay || 0;
    let easing = o.easing || EASE.out;
    if (reduced() && !o.always) {
      if (!isOpacityOnly(kf)) {
        const op = (Array.isArray(kf) ? kf : [kf]).map((f) => ('opacity' in f ? { opacity: f.opacity } : {}));
        if (!op.some((f) => 'opacity' in f)) return null;
        kf = op;
      }
      duration = Math.min(duration, DUR[1]);
      delay = 0;
      easing = 'linear';
    }
    if (!o.keep) cancelSame(el, o.pseudoElement);
    try {
      const a = el.animate(kf, { duration, delay, easing, fill: o.fill || (delay ? 'backwards' : 'none'), pseudoElement: o.pseudoElement, composite: o.composite });
      if (o.id) a.id = o.id;
      return track(el, a);
    } catch (_) { return null; }
  }
  function cancelSame(el, pseudo) {
    const s = running.get(el);
    if (!s) return;
    for (const a of [...s]) {
      const p = a.effect && a.effect.pseudoElement;
      if ((p || undefined) === (pseudo || undefined)) { try { a.cancel(); } catch (_) { /* gone */ } s.delete(a); }
    }
  }

  // ---------------------------------------------------------------- enter / leave / fade
  const OFFSETS = { up: ['0px', `${SHIFT / 2}px`], down: ['0px', `${-SHIFT / 2}px`], right: [`${SHIFT}px`, '0px'], left: [`${-SHIFT}px`, '0px'] };
  /** Fade (and slide) an element in. from: 'up' (rises 4px) | 'down' | 'right' (comes from the right) | 'left' | 'scale' | 'none'. */
  function enter(el, o = {}) {
    if (!el) return null;
    el.__tpLeave = null;
    const from = o.from || 'up';
    const a = { opacity: 0 }, b = { opacity: 1 };
    if (OFFSETS[from]) { a.translate = OFFSETS[from].join(' '); b.translate = '0px 0px'; }
    if (from === 'scale') { a.scale = String(o.scale ?? 0.96); b.scale = '1'; }
    return animate(el, [a, b], { duration: o.duration ?? DUR[2], delay: o.delay, easing: o.easing || (from === 'scale' ? EASE.smooth : EASE.out), id: 'tp-enter' });
  }
  /**
   * Fade an element out, then call onDone (e.g. el.hidden = true). Motion off → onDone runs synchronously.
   * enter(el) / cancel(el) before it ends aborts the leave (onDone is not called). → Promise<boolean finished>
   */
  function leave(el, o = {}) {
    const done = () => { try { o.onDone && o.onDone(); } catch (e) { console.warn('[Toledo+] motion leave', e); } };
    if (!el || off() || !el.isConnected) { done(); return Promise.resolve(true); }
    const to = o.to || 'down';
    const a = { opacity: 1 }, b = { opacity: 0 };
    if (OFFSETS[to]) { a.translate = '0px 0px'; b.translate = OFFSETS[to].join(' '); }
    if (to === 'scale') { a.scale = '1'; b.scale = String(o.scale ?? 0.96); }
    const anim = animate(el, [a, b], { duration: o.duration ?? DUR[1], easing: EASE.in, fill: 'forwards', id: 'tp-leave' });
    if (!anim) { done(); return Promise.resolve(true); }
    const token = {};
    el.__tpLeave = token;
    return anim.finished.then(() => {
      if (el.__tpLeave !== token) return false;
      el.__tpLeave = null;
      done();
      try { anim.cancel(); } catch (_) { /* gone */ }
      return true;
    }, () => false);
  }
  /** Is a leave() running on el? */
  const leaving = (el) => !!(el && el.__tpLeave);
  const fade = (el, o = {}) => animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: o.duration ?? DUR[2], delay: o.delay, easing: EASE.standard });

  // ---------------------------------------------------------------- view changes
  /**
   * Run update() (sync DOM change) and animate root's new content in.
   * direction: 'forward' (deeper: slides in from the right) | 'back' (from the left) | 'none' (plain fade).
   * viewTransition: true → use an element-scoped View Transition (root.startViewTransition, Chrome 147+) for a real
   * crossfade of a small, bounded box; falls back to the WAAPI enter. Never used for whole views: a VT snapshots the
   * scope (memory on long pages) and swallows clicks inside it while it runs. → Promise (resolves when done)
   */
  function transition(root, update, o = {}) {
    const run = () => { try { update && update(); } catch (e) { console.warn('[Toledo+] motion update', e); } };
    if (!root || off()) { run(); return Promise.resolve(); }
    if (o.viewTransition && typeof root.startViewTransition === 'function' && !reduced()) {
      try {
        const vt = root.startViewTransition(run);
        return vt.finished.catch(() => {});
      } catch (_) { /* fall through */ }
    }
    run();
    const dir = o.direction === 'forward' ? 'right' : o.direction === 'back' ? 'left' : 'none';
    const a = enter(root, { from: dir, duration: o.duration ?? (dir === 'none' ? DUR[2] : DUR[3]), easing: EASE.out });
    return a ? a.finished.then(() => {}, () => {}) : Promise.resolve();
  }

  // ---------------------------------------------------------------- lists
  const inView = (r, m = 40) => r && r.bottom > -m && r.top < (globalThis.innerHeight || 800) + m && r.width > 0 && r.height > 0;
  /** Staggered fade-up of the first rows (max `max` steps of `step` ms; later rows join the last step). */
  function stagger(list, o = {}) {
    if (off() || reduced()) return [];
    const step = o.step ?? 20, max = o.max ?? 8;
    const els = [...(list || [])].filter((el) => el && el.isConnected);
    const out = [];
    let i = 0;
    for (const el of els) {
      if (o.onlyInView !== false && !inView(el.getBoundingClientRect())) continue;
      const a = animate(el, [{ opacity: 0, translate: '0px 6px' }, { opacity: 1, translate: '0px 0px' }],
        { duration: o.duration ?? DUR[3], delay: (o.delay || 0) + Math.min(i, max) * step, easing: EASE.out, id: 'tp-stagger' });
      if (a) out.push(a);
      i++;
    }
    return out;
  }

  // FLIP: elements that keep their identity across a DOM change (even an innerHTML re-render) are matched by key.
  const FLIP_SEL = '[data-flip], [data-q], [data-lq], section[data-section], .cv-sec[data-sec], details[data-id], .tp-seg-pill, .tp-banner[data-banner]';
  const MAX_ITEMS = 600, MAX_GHOSTS = 12;
  function keyOf(el) {
    const d = el.dataset || {};
    if (d.flip) return 'f:' + d.flip;
    if (el.classList.contains('tp-seg-pill')) return 'pill:' + (el.parentElement?.querySelector('input')?.name || '');
    if (d.banner) return 'b:' + d.banner;
    if (d.section) return 's:' + d.section;
    if (d.sec) return 'c:' + d.sec;
    if (el.tagName === 'DETAILS' && d.id) return 'd:' + d.id;
    if (d.q != null) return 'q:' + d.q.slice(0, 160);
    if (d.lq != null) return 'l:' + d.lq.slice(0, 160);
    return null;
  }
  function measure(container, sel) {
    const map = new Map();
    const dup = new Map();
    const els = container.querySelectorAll(sel);
    const n = Math.min(els.length, MAX_ITEMS);
    for (let i = 0; i < n; i++) {
      const el = els[i];
      if (el.classList.contains('tp-ghost')) continue;
      let k = keyOf(el);
      if (k == null) continue;
      const c = (dup.get(k) || 0) + 1;
      dup.set(k, c);
      if (c > 1) k += '#' + c;
      map.set(k, { el, rect: el.getBoundingClientRect() });
    }
    return map;
  }
  /** Mid-transition switches: remember where the thumb is so a re-render can continue the motion. */
  function measureSwitches(container) {
    const out = new Map();
    if (typeof Element.prototype.getAnimations !== 'function') return out;
    for (const sw of container.querySelectorAll('input.tp-switch')) {
      if (!sw.name || !sw.getAnimations({ subtree: true }).length) continue;
      try {
        const cs = getComputedStyle(sw, '::before');
        out.set(sw.name, { checked: sw.checked, thumb: cs.transform, bg: getComputedStyle(sw).backgroundColor });
      } catch (_) { /* ignore */ }
    }
    return out;
  }
  function continueSwitches(container, before) {
    for (const [name, b] of before) {
      let sw = null;
      try { sw = container.querySelector(`input.tp-switch[name="${CSS.escape(name)}"]`); } catch (_) { sw = null; }
      if (!sw || sw.checked !== b.checked) continue;
      const end = getComputedStyle(sw, '::before').transform;
      if (end !== b.thumb) animate(sw, [{ transform: b.thumb === 'none' ? 'translateX(0)' : b.thumb }, { transform: end === 'none' ? 'translateX(0)' : end }], { duration: DUR[3], easing: EASE.spring, pseudoElement: '::before', keep: true });
      const bg = getComputedStyle(sw).backgroundColor;
      if (bg !== b.bg) animate(sw, [{ backgroundColor: b.bg }, { backgroundColor: bg }], { duration: DUR[2], easing: EASE.standard, keep: true });
    }
  }
  const flipping = new WeakMap(); // container → Set<Animation> of its last flip
  function clearGhosts(container) { container.querySelectorAll(':scope .tp-ghost').forEach((g) => g.remove()); }

  /** Clone a removed/hidden row as a fading, non-interactive ghost at its old place (needs a live host). */
  function ghost(b, host, anims) {
    const r = b.rect;
    if (r.height > 360) return;
    const hr = host.getBoundingClientRect();
    const g = b.el.cloneNode(true);
    g.removeAttribute('hidden');
    g.removeAttribute('id');
    g.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    g.classList.add('tp-ghost');
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('inert', '');
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    Object.assign(g.style, {
      position: 'absolute', margin: '0', boxSizing: 'border-box', pointerEvents: 'none',
      left: `${r.left - hr.left - host.clientLeft + host.scrollLeft}px`, top: `${r.top - hr.top - host.clientTop + host.scrollTop}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    host.insertBefore(g, host.firstChild);
    const a = animate(g, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.98' }], { duration: DUR[2], easing: EASE.in, fill: 'forwards' });
    if (!a) { g.remove(); return; }
    anims.add(a);
    const rm = () => g.remove();
    a.finished.then(rm, rm);
  }
  /** Where to put a ghost: its old parent when still in the document, else the new parent of an old neighbour. */
  function ghostHost(b, after, container) {
    const p = b.el.parentElement;
    if (p && p.isConnected && container.contains(p)) return p;
    for (const sib of [b.el.previousElementSibling, b.el.nextElementSibling]) {
      const k = sib && keyOf(sib);
      if (!k) continue;
      for (const [k2, a] of after) if (k2 === k || k2.startsWith(k + '#')) { if (a.el.parentElement) return a.el.parentElement; break; }
    }
    return null;
  }

  /**
   * FLIP around a DOM change: rows that moved glide to their new place (smooth spring), new rows fade up
   * (staggered when several), removed/hidden rows fade out as ghosts while the rest closes the gap.
   * Works across innerHTML re-renders: rows are matched by key (data-flip, data-q, data-lq, sections…).
   * Only rows near the viewport animate. mutate() may return a promise (the settle waits for it).
   * o: { selector, highlight (tint pulse on new rows), stagger }. → mutate()'s result
   */
  let flipDepth = 0; // nested flip() calls (a view painting inside the shell's flip) just run: the outer one animates
  function flip(container, mutate, o = {}) {
    const run = () => { flipDepth++; try { return mutate(); } finally { flipDepth--; } };
    if (!container || flipDepth > 0 || off() || !container.isConnected) return run();
    clearGhosts(container);
    const sel = o.selector || FLIP_SEL;
    const before = measure(container, sel);
    const switches = measureSwitches(container);
    const prev = flipping.get(container);
    if (prev) { for (const a of prev) { try { a.cancel(); } catch (_) { /* gone */ } } }
    const r = run();
    const go = () => settle(container, before, switches, sel, o);
    if (r && typeof r.then === 'function') return r.then((v) => { go(); return v; }, (e) => { go(); throw e; });
    go();
    return r;
  }
  function settle(container, before, switches, sel, o) {
    if (!container.isConnected || off()) return;
    if (switches.size) continueSwitches(container, switches);
    if (!before.size) return; // first paint: the route enter / stagger handles it
    const anims = new Set();
    flipping.set(container, anims);
    const after = measure(container, sel);
    const rm = reduced();
    const moved = new Map(); // el → [dx, dy] total
    const fresh = [];
    const freshSet = new Set();
    const nearestIn = (el, map) => { for (let p = el.parentElement; p && p !== container; p = p.parentElement) if (map.has(p)) return p; return null; };
    for (const [k, a] of after) {
      const b = before.get(k);
      const visible = a.rect.width > 0 && a.rect.height > 0;
      if (!visible) continue;
      if (!b || !(b.rect.width > 0 && b.rect.height > 0)) {
        if (inView(a.rect) && !nearestIn(a.el, freshSet)) { fresh.push(a.el); freshSet.add(a.el); }
        continue;
      }
      let dx = b.rect.left - a.rect.left, dy = b.rect.top - a.rect.top;
      const anc = nearestIn(a.el, moved);
      const total = [dx, dy];
      if (anc) { const d = moved.get(anc); dx -= d[0]; dy -= d[1]; }
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { if (anc) moved.set(a.el, total); continue; }
      if (!inView(a.rect, 200) && !inView(b.rect, 200)) continue;
      moved.set(a.el, total);
      if (rm) continue;
      const anim = animate(a.el, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }],
        { duration: DUR[3], easing: a.el.classList.contains('tp-seg-pill') ? EASE.spring : EASE.smooth, keep: true });
      if (anim) anims.add(anim);
    }
    // removed (or hidden) rows that were visible: ghosts (outermost only)
    if (!rm) {
      const gone = [];
      for (const [k, b] of before) {
        if (!inView(b.rect)) continue;
        const a = after.get(k);
        if (a && a.rect.width > 0 && a.rect.height > 0) continue;
        gone.push(b);
      }
      const goneEls = new Set(gone.map((b) => b.el));
      let n = 0;
      for (const b of gone) {
        if (n >= MAX_GHOSTS) break;
        let nested = false;
        for (let p = b.el.parentElement; p; p = p.parentElement) if (goneEls.has(p)) { nested = true; break; }
        if (nested || b.el.classList.contains('tp-seg-pill')) continue;
        const host = ghostHost(b, after, container);
        if (!host) continue;
        ghost(b, host, anims);
        n++;
      }
    }
    // new rows: fade up, staggered (≤ 8 steps of 20 ms)
    const tint = o.highlight ? (getComputedStyle(container).getPropertyValue('--tint-soft').trim() || 'rgba(0,122,255,.15)') : null;
    fresh.forEach((el, i) => {
      const a = animate(el, [{ opacity: 0, translate: '0px 4px' }, { opacity: 1, translate: '0px 0px' }],
        { duration: DUR[2], delay: Math.min(i, 8) * 20, easing: EASE.out, keep: true });
      if (a) anims.add(a);
      if (tint) highlight(el, tint);
    });
  }

  /** Brief tint pulse (new items after ↻). */
  function highlight(el, color) {
    if (!el) return null;
    const c = color || (getComputedStyle(el).getPropertyValue('--tint-soft').trim() || 'rgba(0,122,255,.15)');
    return animate(el, [{ backgroundColor: c }, { backgroundColor: c, offset: 0.4 }, { backgroundColor: 'transparent' }], { duration: 1600, easing: EASE.standard, keep: true, always: true });
  }

  // ---------------------------------------------------------------- height (disclosures fallback, banners)
  /** Grow an element from 0 to its natural height (+ fade). Short layout animation; use for small blocks only. */
  function expand(el, o = {}) {
    if (!el || off() || reduced()) return reduced() ? fade(el, { duration: DUR[1] }) : null;
    const h = el.getBoundingClientRect().height;
    if (!h) return null;
    const a = animate(el, [{ height: '0px', opacity: 0, overflow: 'clip' }, { height: `${h}px`, opacity: 1, overflow: 'clip' }], { duration: o.duration ?? DUR[2], easing: EASE.smooth });
    return a;
  }
  /** Shrink to 0 (+ fade), then onDone. → Promise */
  function collapse(el, o = {}) {
    const done = () => { try { o.onDone && o.onDone(); } catch (_) { /* ignore */ } };
    if (!el || off() || !el.isConnected) { done(); return Promise.resolve(); }
    if (reduced()) return leave(el, { to: 'none', duration: DUR[1], onDone: o.onDone }).then(() => {});
    const h = el.getBoundingClientRect().height;
    const a = animate(el, [{ height: `${h}px`, opacity: 1, overflow: 'clip' }, { height: '0px', opacity: 0, overflow: 'clip' }], { duration: o.duration ?? DUR[2], easing: EASE.in, fill: 'forwards' });
    if (!a) { done(); return Promise.resolve(); }
    return a.finished.then(() => { done(); try { a.cancel(); } catch (_) { /* gone */ } }, () => {});
  }

  /** ::details-content + interpolate-size (Chrome 131+) animate <details> in CSS; older browsers get this
      WAAPI fallback on open (the shell calls it from a 'toggle' listener). */
  const cssDetails = (() => { try { return !!(globalThis.CSS && CSS.supports('selector(::details-content)') && CSS.supports('interpolate-size', 'allow-keywords')); } catch (_) { return false; } })();
  // Large disclosures (the course content tree: .cv-folder / [data-motion-fade]) never animate their height (a layout
  // per frame for the whole column); their content fades and rises 4px instead — opacity/transform only.
  function detailsToggled(d) {
    if (!d || !d.open || off()) return;
    const body = [...d.children].find((c) => c.tagName !== 'SUMMARY');
    if (!body) return;
    if (d.matches('.cv-folder, [data-motion-fade]')) { enter(body, { from: 'up', duration: DUR[2] }); return; }
    if (!cssDetails) expand(body);
  }

  TP.motion = {
    DUR, EASE,
    get disabled() { return isDisabled(); },
    set disabled(v) { forced = v == null ? null : !!v; },
    reduced, sync, animate, cancel, enter, leave, leaving, fade, transition, stagger, flip, highlight, expand, collapse,
    detailsToggled, cssDetails,
    _keyOf: keyOf,
  };
})();
