# Toledo+ design spec

Distilled from two research passes (sources at the bottom). Follow Apple's Human Interface Guidelines
(hierarchy, harmony, consistency) translated to the web, plus WCAG 2.2 AA.

## Product principles (what students need from an LMS front-end)
1. **Deadlines first, everywhere.** One chronological list with course + due date + time left. Urgency never by color alone (icon + word).
2. **One "what changed" feed**, grouped per course, compact, with read/unread that syncs with Toledo. Ad Valvas (school notices) separate and quiet.
3. **Current courses only by default**, readable names (nickname), course color, pin/hide. Archive (older years, communities) one click away.
4. **Every course looks the same**: header (name, code, "13 items · 3 nieuw" in label-2, teachers), Recent, Content tree, Deadlines, Announcements.
5. **Folders vs files clearly distinct**, file type visible, full names on hover/wrap, search across the course.
6. **Fewer clicks**: deep links, "Continue where you left off" (recently opened items), search (⌘K).
7. **Honest about gaps**: no grades, no submission status, schedule only today/tomorrow → say so in one line + link to KU Loket uurrooster. "Done" on a deadline is the student's own mark.
8. **Defaults right out of the box**; ≤ ~10 settings, applied instantly, no Save button.
9. **Fast**: render instantly from cache, refresh in background, show "Last updated hh:mm".

Over-engineering to avoid: drag-and-drop widget builders, themes beyond light/dark + accent, gamification, notification rule editors.

## Tokens (web translation of HIG)
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", system-ui, sans-serif`; display sizes use "SF Pro Display". All sizes in rem (shadow host 16px). `font-optical-sizing:auto`.
- Type scale (density **standard** default; compact = macOS sizes; comfortable = iOS sizes):
  | token | compact | standard | comfortable | weight |
  |---|---|---|---|---|
  | largeTitle | 26/32 | 30/36 | 34/41 | 700 |
  | title2 (section) | 17/22 | 20/25 | 22/28 | 700 |
  | headline | 13/16 | 15/20 | 17/22 | 600 |
  | body | 13/16 | 15/20 | 17/22 | 400 |
  | subhead | 11/14 | 13/18 | 15/20 | 400 |
  | footnote | 10/13 | 12/16 | 13/18 | 400 |
- Spacing scale 2 4 8 12 16 20 24 32 48. Content margin 16 (mobile) / 24 (desktop) / 32 (≥1100). Section gap 28.
- Radii: controls 8, inset groups 12, popovers/sheets 16, pills 999. Concentric: inner = outer − padding.
- Row: min-height 44 (compact 36), padding 11 16; hairline separators 0.5px inset to text start.
- Colors (semantic vars only):
  | var | light | dark |
  |---|---|---|
  | --bg | #F2F2F7 | #000000 |
  | --bg-2 (cards) | #FFFFFF | #1C1C1E |
  | --bg-3 (elevated/popover) | #FFFFFF | #2C2C2E |
  | --label | #000 | #FFF |
  | --label-2 | rgba(60,60,67,.76) (.72 is 4.47:1 on --bg) | rgba(235,235,245,.70) |
  | --label-3 (decoration only) | rgba(60,60,67,.30) | rgba(235,235,245,.30) |
  | --separator | rgba(60,60,67,.22) | rgba(84,84,88,.6) |
  | --fill | rgba(120,120,128,.14) | rgba(120,120,128,.28) |
  | --red | #D70015 (text) / #FF3B30 (fill) | #FF453A |
  | --orange | #C93400 (text) / #FF9500 (fill) | #FF9F0A |
  | --green | #248A3D / #34C759 | #30D158 |
  - `--tint` = chosen accent (PALETTE); `--tint-text` = darkened/lightened variant reaching ≥4.5:1 on --bg-2 (compute in JS; e.g. blue light → #0040DD... #0062CC ok). White text on tint fills at weight ≥600.
  - `prefers-contrast: more` → use the accessible (darker) variants and stronger separators.
- Appearance: follow system by default; Settings offers System/Light/Dark.

## Materials (Liquid Glass)
- Glass ONLY on the navigation layer: sidebar, toolbar, tab bar, popovers/menus. Never on content cards or page background. No glass on glass (controls on glass use `--fill`).
- Light: `rgba(255,255,255,.72)` + `backdrop-filter: blur(20px) saturate(180%)` + `.5px solid rgba(0,0,0,.08)` border; Dark: `rgba(30,30,30,.62)`.
- `prefers-reduced-transparency: reduce` → opaque `--bg-3`. `prefers-reduced-motion: reduce` → no transforms/animations (fades only).

## Components
- **Sidebar (≥700px)**: 240px, glass, sticky full height. Items 32px tall, 20px outlined icons in `--tint`, selected = `--tint` 15% fill + label weight 600, radius 8. Trailing counts in label-2 (red badge only for overdue). Group "Vakken" lists **only the courses the student added** ("Zet in zijbalk" on the course page, the Vakken cards or Vakken › Bewerk; colour dot + name, courses sort) and is absent when empty. Settings pinned to bottom. Sticky full height (own vertical scroll for long lists). **Never scrolls horizontally**: names ellipsize, badges don't push the width. Collapses with ⌘\ (or the toolbar button) to a **64px icon rail** (macOS style): centred icons with tooltips, counts as a dot (red badge only for overdue), pinned courses as coloured circles with two initials, Toledo+ mark on top, Settings at the bottom; same glass, focus order and `aria-current`. `<nav aria-label>` + `aria-current="page"`.
- **Tab bar (<700px)**: floating glass pill bottom center, 5 items (Overview, Courses, Deadlines, Planning, More), icon + short label, whole item ≥44×44. More opens a sheet with Announcements + Settings. `<nav>` + aria-current (not tablist). Page gets bottom padding so content/focus is never hidden.
- **Toolbar**: sticky glass, 52px desktop / 44px mobile: (sidebar toggle) · title (inline once the large title scrolls away) · search (36px, radius 10, magnifier, clear, ⌘K and "/") · mail (envelope, grey unread badge, Outlook in a new tab; phones: More sheet) · refresh · account menu. Max 3 trailing actions. The trailing controls end at the content column's right edge.
- **Large title** at top of content (largeTitle), optional subtitle line (label-2), e.g. date + "Last updated 14:02".
- **Inset grouped list** with optional section header (Title 2 + trailing plain action) and footer (footnote, label-2).
- **Row**: leading 28px icon tile (radius 7, --fill) or color dot; title (body, 1 line ellipsis, full name in `title` attr); secondary (subhead, label-2); trailing value/badge/chevron (label-3). Hover = --fill. Whole row is the hit target.
- **Disclosure** (content tree, feed groups, announcements): chevron trailing (rotates 90°, `--dur-2` `--ease-out`; none under reduced motion), `<details>/<summary>` acceptable (native disclosure semantics); opening animates per **Motion** below. Indent 20px per level, max ~3 levels visible.
- **Badge**: min 18px tall, padding 0 6, 12px 600, pill; tint for new, red for overdue, gray neutral; "99+"; `aria-label="3 nieuw"`.
- **Segmented control**: track --fill, selected segment = one sliding pill (--bg-3 with shadow, `--ease-spring`), 28/32px tall, ≤5 segments; radio inputs.
- **Switch**: 38×22 desktop (51×31 comfortable), on = --tint; native checkbox with role=switch.
- **Settings**: inset grouped; label leading, control trailing; changes apply instantly; no "Bijgewerkt" line; group headers: Taal, Weergave, Overzicht (start page, sections with switch + ↑/↓, announcements in Nieuw, courses in Nieuw), Deadlines, Vakken (drill-in per course: nickname, color swatches, pin, hide), Synchronisatie met Toledo (incl. "Vastgezette vakken als favoriet in Toledo"), Toledo-pagina's (portal/vakken/diepere pagina's), Gegevens (export/import/reset), Over (version, GitHub, report issue).
- *(historical, removed in v1.2 — v1.5 "Zet in zijbalk" is a local sidebar choice, not a favourite)* **Pin = favourite**: one pin control ("Vastzetten", icon pin/pinFill), no separate star. Pinned courses sit in the sidebar "Vastgezet" group and first in lists; with favourite sync on they are the Toledo favourites.
- **Search**: the toolbar field filters the current view live; on Overview it also searches courses, feed, deadlines.
- **Command palette (⌘K, `/`)**: centred glass popover (max-width 640, top 15vh; full-screen sheet on phones) with a search field and grouped results: Navigatie, Vakken, Documenten (all course trees, with course + folder path), Deadlines, Mededelingen; empty query shows Recent. ↑/↓, ↵ open, ⌘↵ download, Esc close. Footer line tells how much is indexed ("Doorzoekt 214 documenten in 15 vakken · bijgewerkt 17:40"). Empty state, once per view, centred: magnifier icon (32px, label-3), "Geen resultaten" (headline), "voor “x”" (subhead, label-2).

## Compact "New" feed (Overview)
- One row per course: color dot · course name · summary line in label-2 ("2 bestanden · 1 video · 1 opdracht") · trailing badge count + latest relative time. Collapsed by default.
- Order: pinned → courses with deadline ≤48h → latest activity. Show `feed.maxCourses` (5) then "Toon alle (12)".
- Expanding shows ≤ 3 items (type icon, title 1-line, relative time) + "Nog 5 in <course> ›" linking to the course.
- Opening an item marks it read (sync to Toledo). Section action "Alles gelezen" marks all read. Keep the list stable while reading (don't remove rows until re-render after navigation/refresh).
- Empty: "Je bent helemaal bij." + "Bijgewerkt 14:02". Loading: skeleton rows of the same geometry after 300ms. Error: inline row "Kon Toledo niet laden · Opnieuw" while still showing cached data.

## Layout
- <700px: single column, tab bar, comfortable-ish touch sizes. 700–1099: sidebar (icon rail by default < 900, expands as an overlay) + one column. ≥1100: sidebar + one **centred** content column of at most 1240px: main + side column `clamp(280px, 30%, 340px)` (schedule/announcements on overview; deadlines/announcements/teachers on course). List views (deadlines, announcements, KU Loket, settings) use a centred 760px column. Nothing sits as a strip next to an empty area.
- Spacing: content margin 16 / 24 / 32 (<700 / ≥700 / ≥1100); section gap 28 (compact 22); section titles inset 4px, day headers likewise; group footers and row text inset 16; cards (welcome card) padding 16/20 with 12 between blocks and 16 above the button.
- Greeting: "Goedemorgen / Goedemiddag / Goedenavond, <voornaam>" (first name from Ultra, kept locally; plain greeting when unknown).
- Zoom to 200% without horizontal scroll; reflow at 320px.

## Motion (v1.5)
Motion explains where things come from and go; it never makes the student wait. Budget: **≤ 350 ms, opacity/transform only
where possible, interruptible, never blocks input, no layout shift; reduced motion = fades only (≤ 120 ms)**.

**Decision (research Oct 2026): native APIs, no library.**
| Option | Verdict |
|---|---|
| Framer Motion | React-only → not applicable (vanilla IIFEs, no build step). |
| Motion (motion.dev) vanilla `animate()` | MIT, ~2.6–3.2 kB "mini" (WAAPI under the hood) / ~18–22 kB full. Adds springs, stagger, sequencing — all of which we get from WAAPI + CSS `linear()` in ~200 lines. Not worth a vendored dependency (would have to live in `src/vendor/`, never loaded remotely: MV3 forbids remote code). |
| **Web Animations API** (`el.animate`) | ✔ Everything JS starts: route enter, FLIP, stagger, menus, toasts, ghosts. Interruptible (`cancel`, start from the current visual position), animates individual `translate`/`scale` so it never fights a component's own `transform`. |
| **CSS `linear()` easing** (Chrome 113+) | ✔ Spring curves without JS: a damped spring sampled into `linear()` (ζ≈0.72 ≈ 4 % overshoot for controls; ζ≈0.9 for moves/sheets); cubic-bezier fallback. |
| **`@starting-style` + `transition-behavior: allow-discrete` on `display`/`overlay`** (Chrome 117+) | ✔ Dialog **entry and exit** in pure CSS; `close()` stays synchronous so focus returns at once while the dialog fades in the top layer. |
| **`interpolate-size: allow-keywords` + `::details-content`** (Chrome 129 / 131) | ✔ `<details>` animate to `height:auto` — for small disclosures only (see below); a JS fallback opens them on older browsers. |
| **View Transitions** | Same-document `document.startViewTransition` snapshots the whole page (our shadow root included) and its pseudo-tree swallows hit-testing while it runs; **element-scoped** `el.startViewTransition` (Chrome 147+, works inside our shadow root — verified in Chromium 153) is bounded but still freezes and snapshots the scope, which is costly for long views. → available as an opt-in (`TP.motion.transition(…, {viewTransition:true})`) for small bounded swaps; route changes use WAAPI. Cross-document VTs don't apply (portal ↔ Ultra are different sites). |

**Tokens** (`ui.css`, mirrored by `TP.motion.DUR` / `TP.motion.EASE`): `--dur-1` 120 ms (hover, press, small fades, reduced motion) ·
`--dur-2` 200 ms (menus, disclosures, fades, toasts) · `--dur-3` 280 ms (route slide, sheets, FLIP moves) · `--dur-4` 350 ms (max) ·
`--ease` standard · `--ease-out` entering · `--ease-in` leaving · `--ease-spring` controls · `--ease-smooth` moves/sheets.

**What moves where**
- Route change: the new view is in the DOM at once and fades in with an 8 px slide — deeper (list → detail, courses → course)
  from the right, back from the left, sidebar/tab jumps plain fade. Browser back restores the scroll position.
- First paint: rows fade up in a 20 ms stagger (max 8 steps). Skeleton → content: the new rows fade up (no pop).
- Lists (filter, search, sort, reorder, data refresh): FLIP — rows matched by key across re-renders glide to their new place,
  new rows fade up, removed rows fade out as inert ghosts while the rest closes the gap. Only rows near the viewport animate.
  After ↻, new rows get a brief tint.
- Disclosures: Nieuw groups, documents, announcements, "Ouder dan een week", hidden courses animate their height; **content-tree
  folders fade/rise their rows instead** (a height animation re-lays out the long course column every frame — measured
  +3 janky frames at 4× CPU throttling). Chevrons rotate.
- Dialogs: ⌘K and the detail sheet scale+fade (phones: slide up), the More sheet slides up, backdrops fade — in and out.
  Account menu scales from its corner; agenda popovers scale in from their anchor; toasts slide up and stack (max 3).
- Controls: segmented controls have one sliding pill; switches a spring thumb that stretches while pressed; the phone tab bar
  a sliding selection pill; buttons/tabs press to 0.97; hovers 120 ms. The sidebar column animates between rail and expanded,
  labels fade in behind it.
- Perceived speed: cached content renders first; the course page header comes from cache; `aria-busy` while loading;
  resting on a course link resolves its Ultra id so the click skips the journey redirect.

**Rules for new UI**: use the tokens; animate `opacity`/`translate`/`scale` (never `top/left/width`, avoid `height` on big
blocks); don't delay a DOM change for an animation; keep focus where the student expects it; `will-change` only on what
animates right now. Tests run with motion off (`<html data-tp-motion="off">`); `tests/e2e/motion.e2e.js` covers the motion
path, `tests/perf/motion-capture.js` records videos and 4×-throttled frame/long-task numbers.

Sources: Chrome for Developers — [element-scoped view transitions](https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions),
[`linear()` easing](https://developer.chrome.com/docs/css-ui/css-linear-easing-function),
[entry/exit animations (`@starting-style`, `allow-discrete`)](https://developer.chrome.com/blog/entry-exit-animations),
[animate to `height: auto`](https://developer.chrome.com/docs/css-ui/animate-to-height-auto);
Motion — [feature comparison / bundle sizes](https://motion.dev/docs/feature-comparison); Apple HIG — Motion.

## Accessibility checklist
Contrast ≥4.5:1 text, ≥3:1 UI boundaries/large text · visible `:focus-visible` (2px --tint outline, 2px offset) never hidden under sticky bars (scroll-padding) · targets ≥24×24 (44 for touch rows) · skip link · landmarks (nav/main/aside) · `aria-current` · disclosure semantics · live region for "Bijgewerkt, 4 nieuwe items" · `lang` attribute per UI language · never color alone · all icons decorative unless icon-only control (then aria-label).

## Sources
- Apple HIG: Sidebars, Tab bars, Typography, Dark Mode, Materials, Color (developer.apple.com/design/human-interface-guidelines); WWDC25 "Meet Liquid Glass".
- WCAG 2.2 (w3.org/TR/WCAG22), WAI-ARIA APG disclosure & tabs patterns; NN/g progressive disclosure & skeleton screens.
- University of Twente Canvas dashboard redesign (n=95); University of Edinburgh Learn Ultra student UX research; William Paterson Blackboard Ultra student survey (n=1,104); EDUCAUSE 2025 USC student-centred LMS; Ohio State "Carmen Common Sense"; Phil Hill LMS survey analysis; Edinburgh "notification fatigue".
