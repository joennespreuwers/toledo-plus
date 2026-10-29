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
- Font (v1.6, brand): **Inter** — `"TP Inter", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif` (see **Brand › Type**). All sizes in rem (shadow host 16px). Large titles 750 (variable, between Bold and ExtraBold), section titles 700, headline 600–650, body 400. Tracking: large title −0.021em, title 2 −0.017em (rsms' dynamic metrics); **everything below 20 px 0** (body, headline, subhead, footnote — reading comfort, WCAG 1.4.12 reference), caps labels +0.06em. `tnum` on counts, times and dates.
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
- Row: min-height 44 (compact 36), padding 11 16; hairline separators 0.5px, full width (edge to edge, the same in every list).
- Colors (semantic vars only; v1.6 brand pass — contrast measured on the actual backgrounds, see **Brand › Contrast**):
  | var | light | dark (on brand ink) |
  |---|---|---|
  | --bg | #F5F4F2 (warm neutral) | #12151C |
  | --bg-2 (cards) | #FFFFFF | #1F2430 (ink) |
  | --bg-3 (elevated/popover) | #FFFFFF | #283040 |
  | --label | #1F2430 (ink) | #F4F5F7 |
  | --label-2 | rgba(31,36,48,.70) — 5.5:1 on --bg | rgba(235,237,245,.68) — 6.1:1 on --bg-3 |
  | --label-3 (decoration only) | rgba(31,36,48,.30) | rgba(235,237,245,.30) |
  | --separator | rgba(31,36,48,.13) | rgba(235,237,245,.12) |
  | --fill / --fill-2 | rgba(118,114,110,.13 / .07) | rgba(150,160,185,.20 / .11) |
  | --red (text) / --red-fill / --red-tile | #D70015 / #FF3B30 / #B0000F | #FF6B61 / #FF453A / #FF6B61 |
  | --amber (text) / --amber-fill ("binnenkort") | #8A5300 / #F5B000 | #FFC542 / #FFB800 |
  | --orange / --orange-fill | aliases of --amber / --amber-fill (legacy names) | idem |
  | --green | #1E7B36 / fill #34C759 | #30D158 |
  | --tint (default accent "Toledo+") | #EE8B35 | #EE8B35 |
  | --tint-text | #C2410C (brandguide) | #F5A35F |
  | --tint-fill / --on-tint | #EE8B35 / ink #1F2430 (6.2:1) | idem |
  - `--tint` = chosen accent (`TP.util.PALETTE`, default `brand`); `--tint-text` reaches ≥4.5:1 on --bg and --bg-3 (computed in `TP.shell` themeVars; the brand accent uses the brandguide's #C2410C / #F5A35F). Filled controls: tints that are light enough keep the colour with **ink** text, others darken until white text passes.
  - Surfaces: light cards get `--shadow-card` (hairline ring + two soft layers), dark cards a hairline ring only; `--r-group` 14, `--r-pop` 18, `--r-tile` 8. Icon tiles: `--tint-tile` (12 % tint over the card; 18 % in dark).
  - `prefers-contrast: more` → use the accessible (darker) variants and stronger separators.
- Appearance: follow system by default; Settings offers System/Light/Dark.

## Brand (v1.6 — docs/brand, brandguide v1.0)
The UI must read as **Toledo+, not Toledo**: our own name, mark, type and colour everywhere; never Toledo's or KU Leuven's logo.

**Logo** (`TP.ui.logo({variant, size, title})`, inline SVG, geometry verbatim from `docs/brand/logo/*.svg`):
- `tile` — the primary icon (woven plus on an ink rounded tile). **Always below 32 px**: sidebar (28), icon rail (28), phone toolbar (28), deep bar (22), classic-mode pill (28, data URI in page.css), favicon/toolbar icons (`icons/*.png`).
- `glyph` — the plus alone, ≥ 32 px only, on light or dark ground: welcome card (56 on ink), website hero (88). `TP.ui.logo` falls back to the tile when a glyph is asked below 32 px.
- `mono` — one colour (`currentColor`) for tiny decorative uses only.
- Clear space ≥ ¼ of the icon width (28 px tile → 10 px gap to the wordmark; 56 px glyph sits in a 64 px box with 18 px gap).
- Don'ts: no recolouring, rotating, stretching, shadow or glow on the logo; orange always lies on top of magenta; never next to/inside the Toledo or KU Leuven logo.

**Wordmark** (`TP.ui.wordmark()`): "Toledo+" in Inter ExtraBold (800), tracking −0.028em; the plus in brand orange text colour (#C2410C light / #EE8B35 on ink). Always "Toledo+" — plus sign, no space; `toledo-plus` in code/URLs.

**Where the brand shows** (quiet, not loud): sidebar top (tile + wordmark), icon rail (tile), phone toolbar (tile → Overzicht), sidebar footer signature ("**Toledo+** 1.4.0 · Klassieke Toledo" — the classic-Toledo escape stays one click away, also in the account menu), deep bar, classic pill (ink pill with tile), Instellingen › Over (logo 44 + wordmark + version + "Onofficieel studentenproject"), the welcome card (ink card with the glyph, short NL/EN/FR intro, three bullets, privacy line, one orange pill button), the first-boot splash (tile 64 + wordmark, ≤ 400 ms, only without cached data, not with motion off, fades only under reduced motion), empty states (`TP.ui.emptyArt()`: three soft pills from the logo's shapes — an illustration, not the logo), document title "… · Toledo+".

**Colours**: orange #EE8B35 (accent, fills, icons), magenta #E3285A (secondary: only in the mark and illustrations — never for text or state, so it can't be mistaken for "te laat"), ink #1F2430 (text in light, cards in dark, the tile), white. Text on white: #C2410C (orange) / #C81E4E (magenta); on ink white and orange may be text.
- **Accent rules**: default accent `brand` (= orange). Other accents (blue, purple, green, …) stay available; red/pink are never accents (reserved for "te laat"). The brand accent is never a course colour (`TP.util.COURSE_COLORS`).
- **States never look like the accent**: "te laat" = a red-tinted row (`--overdue-bg`) + red date tile + the **status word** ("3 d te laat") in `--red-tile` 600 with a small alert glyph; "binnenkort" = the same pattern in **amber** (not orange): an amber-tinted row (`--urgent-bg`) + amber date tile + the relative date in `--amber` 600 with a clock glyph. The word carries the state (greyscale, projectors, forced colours), the tint only supports it. New = tint-soft badge (never solid).
- **Status colours are reserved**: red/pink ("te laat") and amber/orange/yellow ("binnenkort") are never course colours or tile colours. Course colours (`TP.util.COURSE_COLORS`): blue, green, indigo, teal, purple, brown, navy, forest, plum, olive, slate, lavender (+ graphite for "no course"). Icon tiles are always `--tint-tile` (KU Loket included). Settings v5 migrates the old default accent `blue` to `brand` once (settings are stored whole, so an explicit "blue" chosen before v5 can't be told apart; it can be re-picked and is kept from then on). Every other stored accent is kept.
- Focus ring: 2 px `--tint-text` (#C2410C: 4.7:1 on --bg, #F5A35F: 9:1 on dark), 2 px offset. Selection: tint 30 %. Scrollbars: thin, `--scrollbar` (ink 26 % / white 22 %), page scrollbar via page.css.

**Type**: Inter (OFL 1.1, `fonts/` + `fonts/OFL-Inter.txt`, latin + latin-ext variable wght 100–900). Chrome ignores `@font-face` inside shadow roots, so the shell declares the faces once in the **document** (`<style id="tp-fonts">` + an adopted constructable sheet, which a strict page CSP can't block) under the family name **"TP Inter"** (never touches the host page's own fonts); the shadow tokens use `"TP Inter", "Inter", system-ui, …`. The bundled subset has `tnum`/`pnum`/`frac`/`calt` but no `cv*`/`ss*` sets, so no stylistic alternates are used.

**Contrast** (WCAG 2.2 AA, measured; `--label-2` etc. composited on the background):
| mode | foreground | background | ratio |
|---|---|---|---|
| light | label | --bg / --bg-2 | 14.1 / 15.5 |
| light | label-2 | --bg / --bg-2 | 5.5 / 5.8 |
| light | tint-text #C2410C | --bg / --bg-2 | 4.7 / 5.2 |
| light | red / amber / green | --bg | 4.9 / 5.8 / 4.9 |
| light | overdue date tile (#B0000F, 11 px) | red 16 % tile | 5.9 |
| light | urgent date tile (amber) | amber 20 % tile | 5.6 |
| light | tint-text on icon tile / "new" badge | tint-tile / badge | 4.7 / 4.8 |
| dark | label | --bg / --bg-2 / --bg-3 | 16.7 / 14.2 / 12.1 |
| dark | label-2 | --bg / --bg-2 / --bg-3 | 7.7 / 6.9 / 6.1 |
| dark | tint-text #F5A35F | --bg-3 | 6.5 |
| dark | red #FF6B61 / amber / green | --bg-3 | 4.7 / 8.4 / 6.5 |
| dark | overdue date tile | red 16 % tile | 4.7 |
| both | ink on orange (filled buttons, welcome button) | #EE8B35 | 6.2 |
| both | white on red badge | #D70015 | 5.4 |
| both | welcome card text (white .78 / privacy .70) | ink #1F2430 | 9.2 / 7.7 |
| both | toast text | ink | 14.2 |

## Materials (Liquid Glass)
- Glass ONLY on the navigation layer: sidebar, toolbar, tab bar, popovers/menus. Never on content cards or page background. No glass on glass (controls on glass use `--fill`).
- Light: `rgba(255,255,255,.74)` + `backdrop-filter: blur(20px) saturate(180%)` + `.5px solid rgba(31,36,48,.08)` border; Dark: `rgba(24,28,37,.70)` (ink-tinted).
- `prefers-reduced-transparency: reduce` → opaque `--bg-3`. `prefers-reduced-motion: reduce` → no transforms/animations (fades only).

## Components
- **Sidebar (≥700px)**: 240px, glass, sticky full height. Items 32px tall, 20px outlined icons in `--tint`, selected = `--tint` 15% fill + label weight 600, radius 8. Trailing counts in label-2 (red badge only for overdue). Group "Vakken" lists **only the courses the student added** ("Zet in zijbalk" on the course page, the Vakken cards or Vakken › Bewerk; colour dot + name, courses sort) and is absent when empty. Settings pinned to bottom. Sticky full height (own vertical scroll for long lists). **Never scrolls horizontally**: names ellipsize, badges don't push the width. Collapses with ⌘\ (or the toolbar button) to a **64px icon rail** (macOS style): centred icons with tooltips, counts as a dot (red badge only for overdue; on touch screens — `hover: none` — the names show under the icons and counts as numbers), pinned courses as coloured circles with two initials, Toledo+ mark on top, Settings at the bottom; same glass, focus order and `aria-current`. `<nav aria-label>` + `aria-current="page"`.
- **Tab bar (<700px, and short screens ≤500px high up to 1099px wide)**: floating glass pill bottom center, 5 items (Overview, Courses, Deadlines, Planning, More), icon + short label (side by side on short screens), whole item ≥44×44 (36px high on short screens). More opens a sheet with Announcements + Settings and carries a tinted dot when announcements are unread. `<nav>` + aria-current (not tablist). Page gets bottom padding so content/focus is never hidden.
- **Toolbar**: sticky glass, 52px desktop / 44px mobile: (sidebar toggle) · title (inline once the large title scrolls away) · search (36px, radius 10, magnifier, clear, ⌘K and "/") · mail (envelope, grey unread badge, Outlook in a new tab; phones: More sheet) · refresh · account menu. Max 3 trailing actions. The trailing controls end at the content column's right edge.
- **Large title** at top of content (largeTitle), one optional line under it (subhead, label-2): the subtitle and "Bijgewerkt hh:mm" share it ("10 open · Bijgewerkt 14:02"), so every header has the same rhythm. Page actions sit on the title's line.
- **Inset grouped list** with optional section header (Title 2 + trailing plain action) and footer (footnote, label-2).
- **Row**: leading 28px icon tile (radius 7, --fill) or color dot; title (body, 1 line ellipsis, full name in `title` attr); secondary (subhead, label-2); trailing value/badge/chevron (label-3). Hover = --fill. Whole row is the hit target.
- **Disclosure** (content tree, feed groups): chevron trailing (rotates 90°, `--dur-2` `--ease-out`; none under reduced motion), `<details>/<summary>` acceptable (native disclosure semantics); opening animates per **Motion** below. Indent 20px per level, max ~3 levels visible. Announcements are not disclosures: a row opens the **announcement sheet** (detail sheet, 640px: full text, ↑/↓ / j/k through the list, "Open in Ultra/Ad Valvas", "Markeer als ongelezen"; see ARCHITECTURE › Addendum v1.6).
- **Badge**: min 18px tall, padding 0 6, 12px 600, pill; tint for new, red for overdue, gray neutral; "99+"; `aria-label="3 nieuw"`.
- **Page actions** ("Zet in agenda", "Bewerk", "Zet in zijbalk", "Klassieke Toledo", "Open KU Loket"): only via `ctx.setActions` — tinted buttons right of the large title, the same on every page. Views don't build their own header buttons. An action on one list ("Alles als gelezen markeren") sits in that list's section header instead, next to what it acts on (Overzicht › Nieuw, Mededelingen). Its label is a verb and names its scope when the list is narrowed ("Markeer 5 gevonden als gelezen"), and it acts on exactly the rows in view.
- **Undo, not confirm**: a reversible action happens at once and offers **Ongedaan maken** in a toast (`TP.ui.undoToast`, ~8 s, ⌘Z/Ctrl+Z); no "are you sure?" dialogs. Focus never drops to `<body>` when the acting button disappears: it goes to the list's heading.
- **"See all"** links to another page: a plain section-header action (`TP.ui.section({actions})`, e.g. "Alle deadlines", "Agenda", "Alle vakken"), never a row inside the card. (In-place expansion like "Toon alle (12)" / "Nog 5 in …" stays inside the list.)
- **Today** in the agenda (date circle, mini calendar, column tint, now line) uses the accent, not red: red only ever means "te laat".
- **Help text sits next to what it explains**: a section footer (`TP.ui.section({footer})`, directly under its group) or the toast right after the action. No page-bottom footnotes; a page-level fact goes in the subtitle under the large title.
- **Undo, not "are you sure"**: a destructive or bulk action happens at once and its toast offers **Ongedaan maken** (`TP.ui.undoToast(label, restore)`: the toast's one button, 8 s, held while hovered/focused). Used for deleting an own deadline and "Markeer deze n als klaar".
- **Times**: one spelling (`TP.fmt.when`): rows "wo 28 okt 23:59", sheets "Woensdag 28 oktober · 23:59", the year only when it is not this year; ranges "09:00–11:00", "(+1)" when the end is on a later day. On a device that is not on Belgian time, time-based pages carry one line naming the device's zone ("GMT+9") and sheets add it after the time.
- **Same thing, same row**: an exam is drawn by one row (`TP.viewsA.examRow`: date tile, course dot, when · room, relative time; it opens the exam sheet) in Deadlines, Overzicht and KU Loket; a lesson by one row (`TP.viewsA.lessonRow`: times, course bar, room · teachers) in Overzicht and KU Loket. No coloured edge on groups: state lives in the row tint, the date tile, the label and the section title.
- **Empty state**: `TP.ui.empty(text)` shows the pill illustration above the text (`{art:false}` to omit). Inside a card with other content (Rooster "Geen lessen", KU Loket notes) one compact line: subhead, label-2, padding 12/16.
- **"Opens elsewhere" glyph**: one treatment — 14 px, label-3 when it decorates a row or menu item, label-2 when it is the icon-only hit target.
- **Section-header links** ("Alle deadlines", "Agenda") have no typed "›".
- **Segmented control**: track --fill, selected segment = one sliding pill (--bg-3 with shadow, `--ease-spring`), 28/32px tall, ≤5 segments; radio inputs.
- **Switch**: 38×22 desktop (51×31 comfortable), on = --tint-fill (brand orange by default); native checkbox with role=switch.
- **Settings**: inset grouped; label leading, control trailing; changes apply instantly; no "Bijgewerkt" line; group headers: Taal, Weergave, Overzicht (start page, sections with switch + ↑/↓, announcements in Nieuw, courses in Nieuw), Deadlines, Vakken (drill-in per course: nickname, color swatches, pin, hide), Synchronisatie met Toledo (incl. "Vastgezette vakken als favoriet in Toledo"), Toledo-pagina's (portal/vakken/diepere pagina's), Gegevens (export/import/reset), Over (version, GitHub, report issue).
- *(historical, removed in v1.2 — v1.5 "Zet in zijbalk" is a local sidebar choice, not a favourite)* **Pin = favourite**: one pin control ("Vastzetten", icon pin/pinFill), no separate star. Pinned courses sit in the sidebar "Vastgezet" group and first in lists; with favourite sync on they are the Toledo favourites.
- **Search**: the toolbar field filters the current view live; on Overview it also searches courses, feed, deadlines. Every surface (toolbar filter, course search, ⌘K) uses **one matcher** (`TP.index.matcher`): accents and case ignored, all words in any order, course codes with or without the space, dates as the UI shows them ("morgen", "28 okt", "vr 30 okt", "30/10"), one typo in words of 5+ letters only when nothing matches exactly. The same item searches the same fields everywhere (title, course, code, teacher/sender, date). The words that matched are marked in the row title (`mark.tp-hl`: `--tint` at 22 % behind the text, text colour unchanged; `Mark`/`MarkText` in forced colours); a page that matches only in its text is opened on the course page.
- **Command palette (⌘K, `/`)**: centred glass popover (max-width 640, top 15vh; full-screen sheet on phones) with a search field and grouped results: Navigatie, Vakken, Documenten (all course trees, with course + folder path; a query that only names a course does not list its files), In bestanden, Deadlines, Mededelingen, KU Loket (the hub's apps), Instellingen (per section, by the labels inside it); empty query shows Recent. Max 8 rows per group, then a "Nog n resultaten tonen" row that shows the rest. Near matches (one typo) get a one-line note above them; the empty state adds a hint (what you can search for, "still indexing" while the index fills). Opens with the toolbar's text; Back closes it. ↑/↓, ↵ open, ⌘↵ download, Esc close. Footer line tells how much is indexed ("Doorzoekt 214 documenten in 15 vakken · bijgewerkt 17:40"). Empty state, once per view, centred: magnifier icon (32px, label-3), "Geen resultaten" (headline), "voor “x”" (subhead, label-2).

## Compact "New" feed (Overview)
- One row per course: color dot · course name · summary line in label-2 ("2 bestanden · 1 video · 1 opdracht") · trailing badge count + latest relative time. Collapsed by default.
- Order: pinned → courses with deadline ≤48h → latest activity. Show `feed.maxCourses` (5) then "Toon alle (12)".
- Expanding shows ≤ 3 items (type icon, title 1-line, relative time) + "Nog 5 in <course> ›" linking to the course.
- Opening an item marks it read (sync to Toledo). Section action "Alles gelezen" marks all read. Keep the list stable while reading (don't remove rows until re-render after navigation/refresh).
- Empty: "Je bent helemaal bij." + "Bijgewerkt 14:02". Loading: skeleton rows of the same geometry after 300ms. Error: inline row "Kon Toledo niet laden · Opnieuw" while still showing cached data.

## Layout
- <700px: single column, tab bar, comfortable-ish touch sizes. 700–1099: sidebar (icon rail by default < 900, expands as an overlay) + one column. ≥1100: sidebar + one **centred** content column of at most 1240px (≥2200px wide: `min(1680px, 62vw)`): main + side column `clamp(280px, 30%, 340px)` (schedule/announcements on overview; deadlines/announcements/teachers on course). Every view uses that same column (list views too), so switching tabs never moves the title or the edges. Nothing sits as a strip next to an empty area.
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
- Disclosures: Nieuw groups, documents, "Ouder dan een week", hidden courses animate their height; **content-tree
  folders fade/rise their rows instead** (a height animation re-lays out the long course column every frame — measured
  +3 janky frames at 4× CPU throttling). Chevrons rotate.
- Dialogs: ⌘K and the detail sheet (deadlines, announcements) scale+fade (phones: slide up), the More sheet slides up, backdrops fade — in and out.
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
Contrast ≥4.5:1 text, ≥3:1 UI boundaries/large text · visible `:focus-visible` (2px --tint outline, 2px offset) never hidden under sticky bars (scroll-padding) · targets ≥24×24 (44 for touch: `(pointer: coarse)` widens icon buttons with an invisible `::after`) · skip link · landmarks (nav/main/aside) · `aria-current` · disclosure semantics · live region for "Bijgewerkt, 4 nieuwe items" and "Geen resultaten" · `lang` attribute per UI language · never color alone · all icons decorative unless icon-only control (then aria-label).
- **Focus never drops to `<body>`**: re-renders go through `TP.shell.focus` (same control by its data keys; else the next row, the section heading, the large title).
- **One tab stop per composite widget** (mini calendar: roving tabindex, arrows inside — `TP.ui.rovingKey`).
- **Names**: a switch is named by its title only (help text = description); section counts are not part of the heading name (", 3 items").
- **Forced colours** (Windows High Contrast): every state that lives in a fill also has a system-colour border/outline or Highlight; colour choices (swatches, course dots) keep their colour with a frame.
- **Touch (`hover: none`)**: nothing only in a tooltip — rail labels and counts are visible, icon-only toggles get a caption.
- **Print**: light palette whatever the appearance, no app chrome or row controls, rows and headings stay together, the Agenda prints the whole day.

## Sources
- Apple HIG: Sidebars, Tab bars, Typography, Dark Mode, Materials, Color (developer.apple.com/design/human-interface-guidelines); WWDC25 "Meet Liquid Glass".
- WCAG 2.2 (w3.org/TR/WCAG22), WAI-ARIA APG disclosure & tabs patterns; NN/g progressive disclosure & skeleton screens.
- University of Twente Canvas dashboard redesign (n=95); University of Edinburgh Learn Ultra student UX research; William Paterson Blackboard Ultra student survey (n=1,104); EDUCAUSE 2025 USC student-centred LMS; Ohio State "Carmen Common Sense"; Phil Hill LMS survey analysis; Edinburgh "notification fatigue".
