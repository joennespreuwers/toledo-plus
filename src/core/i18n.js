/* Toledo+ — TP.i18n / TP.t: tiny string table with interpolation and plurals.
   Views register their own strings with TP.i18n.add({nl:{…}, en:{…}, fr:{…}}).
   Language comes from settings.language ('system' → navigator.language; default nl). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const LANGS = ['nl', 'en', 'fr'];
  const LOCALES = { nl: 'nl-BE', en: 'en-GB', fr: 'fr-BE' };
  const table = { nl: {}, en: {}, fr: {} };
  const plurals = {};

  function add(strings) {
    for (const lang of Object.keys(strings || {})) {
      if (!table[lang]) continue;
      Object.assign(table[lang], strings[lang]);
    }
  }

  function lang() {
    const pref = TP.settings?.get?.()?.language;
    if (pref && LANGS.includes(pref)) return pref;
    const nav = String((typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || 'nl').slice(0, 2).toLowerCase();
    return LANGS.includes(nav) ? nav : 'nl';
  }
  const locale = () => LOCALES[lang()];
  const apiLang = () => (lang() === 'nl' ? 'nl' : 'en');

  function pluralForm(l, n) {
    try { return (plurals[l] ||= new Intl.PluralRules(LOCALES[l])).select(Number(n)); } catch (_) { return Number(n) === 1 ? 'one' : 'other'; }
  }

  // Fallback chain: current language → en → nl → key itself.
  function lookup(key, vars) {
    const l = lang();
    const chain = [...new Set([l, 'en', 'nl'])];
    const hasN = vars && vars.n != null && vars.n !== '';
    for (const c of chain) {
      const t = table[c];
      if (hasN) {
        const form = pluralForm(c, vars.n);
        if (t[`${key}.${form}`] != null) return t[`${key}.${form}`];
        if (t[`${key}.other`] != null) return t[`${key}.other`];
      }
      if (t[key] != null) return t[key];
    }
    return key;
  }

  // Keyboard modifier per platform: strings are written with "⌘" (macOS); elsewhere they read "Ctrl+".
  // navigator.userAgentData.platform is "macOS" (Chromium), navigator.platform "MacIntel" — match case-insensitively.
  const IS_MAC = (() => { try { return /mac|iphone|ipad|ipod/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || ''); } catch (_) { return false; } })();
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const platformKeys = (s) => (IS_MAC || typeof s !== 'string' || s.indexOf('⌘') < 0 ? s : s.replace(/⌘\s?/g, 'Ctrl+'));

  function tr(key, vars) {
    const s = platformKeys(lookup(key, vars));
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  const has = (key) => LANGS.some((l) => table[l][key] != null);

  TP.i18n = { add, lang, locale, apiLang, has, LANGS, _table: table, isMac: IS_MAC, mod: MOD, keys: platformKeys };
  TP.t = tr;
})();
