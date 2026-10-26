# Toledo+ design spec

Distilled from two research passes (sources at the bottom). Follow Apple's Human Interface Guidelines
(hierarchy, harmony, consistency) translated to the web, plus WCAG 2.2 AA.

## Product principles (what students need from an LMS front-end)
1. **Deadlines first, everywhere.** One chronological list with course + due date + time left. Urgency never by color alone (icon + word).
2. **One "what changed" feed**, grouped per course, compact, with read/unread that syncs with Toledo. Ad Valvas (school notices) separate and quiet.
3. **Current courses only by default**, readable names (nickname), course color, pin/hide. Archive (older years, communities) one click away.
4. **Every course looks the same**: header (name, code, teachers), Recent, Content tree, Deadlines, Announcements.
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
- **Sidebar (≥700px)**: 240px, glass, sticky full height. Items 32px tall, 20px outlined icons in `--tint`, selected = `--tint` 15% fill + label weight 600, radius 8. Trailing counts in label-2 (red badge only for overdue). Group "Vastgezet/Pinned" lists pinned courses (color dot + name). Settings pinned to bottom. Collapsible with ⌘\ (or button in toolbar). `<nav aria-label>` + `aria-current="page"`.
- **Tab bar (<700px)**: floating glass pill bottom center, 5 items (Overview, Courses, Deadlines, Planning, More), icon + short label, whole item ≥44×44. More opens a sheet with Announcements + Settings. `<nav>` + aria-current (not tablist). Page gets bottom padding so content/focus is never hidden.
- **Toolbar**: sticky glass, 52px desktop / 44px mobile: (sidebar toggle) · title (inline once the large title scrolls away) · search (36px, radius 10, magnifier, clear, ⌘K and "/") · refresh · account menu (avatar initials). Max 3 trailing actions.
- **Large title** at top of content (largeTitle), optional subtitle line (label-2), e.g. date + "Last updated 14:02".
- **Inset grouped list** with optional section header (Title 2 + trailing plain action) and footer (footnote, label-2).
- **Row**: leading 28px icon tile (radius 7, --fill) or color dot; title (body, 1 line ellipsis, full name in `title` attr); secondary (subhead, label-2); trailing value/badge/chevron (label-3). Hover = --fill. Whole row is the hit target.
- **Disclosure** (content tree, feed groups, announcements): chevron trailing (rotates 90°, 200ms ease-out; none under reduced motion), `<details>/<summary>` acceptable (native disclosure semantics). Indent 20px per level, max ~3 levels visible.
- **Badge**: min 18px tall, padding 0 6, 12px 600, pill; tint for new, red for overdue, gray neutral; "99+"; `aria-label="3 nieuw"`.
- **Segmented control**: track --fill, selected segment --bg-3 with shadow, 28/32px tall, ≤5 segments; radio inputs.
- **Switch**: 38×22 desktop (51×31 comfortable), on = --tint; native checkbox with role=switch.
- **Settings**: inset grouped; label leading, control trailing; changes apply instantly; group headers: Taal, Weergave, Startpagina, Overzicht-secties (reorder with ↑/↓ buttons + switch), Nieuw, Deadlines, Vakken (drill-in per course: nickname, color swatches, pin, hide), Synchronisatie met Toledo, Toledo-pagina's (portal/vakken/diepere pagina's), Gegevens (export/import/reset), Over (version, GitHub, report issue).
- **Search**: filters the current view live; on Overview it also searches courses, feed, deadlines. Show "No results for “x”" empty state.

## Compact "New" feed (Overview)
- One row per course: color dot · course name · summary line in label-2 ("2 bestanden · 1 video · 1 opdracht") · trailing badge count + latest relative time. Collapsed by default.
- Order: pinned → courses with deadline ≤48h → latest activity. Show `feed.maxCourses` (5) then "Toon alle (12)".
- Expanding shows ≤ 3 items (type icon, title 1-line, relative time) + "Nog 5 in <course> ›" linking to the course.
- Opening an item marks it read (sync to Toledo). Section action "Alles gelezen" marks all read. Keep the list stable while reading (don't remove rows until re-render after navigation/refresh).
- Empty: "Je bent helemaal bij." + "Bijgewerkt 14:02". Loading: skeleton rows of the same geometry after 300ms. Error: inline row "Kon Toledo niet laden · Opnieuw" while still showing cached data.

## Layout
- <700px: single column, tab bar, comfortable-ish touch sizes. 700–1099: sidebar (auto-collapses to overlay < 900) + one column. ≥1100: sidebar + main (max 760) + side column 300–320 (schedule/announcements on overview; deadlines/announcements/teachers on course).
- Zoom to 200% without horizontal scroll; reflow at 320px.

## Accessibility checklist
Contrast ≥4.5:1 text, ≥3:1 UI boundaries/large text · visible `:focus-visible` (2px --tint outline, 2px offset) never hidden under sticky bars (scroll-padding) · targets ≥24×24 (44 for touch rows) · skip link · landmarks (nav/main/aside) · `aria-current` · disclosure semantics · live region for "Bijgewerkt, 4 nieuwe items" · `lang` attribute per UI language · never color alone · all icons decorative unless icon-only control (then aria-label).

## Sources
- Apple HIG: Sidebars, Tab bars, Typography, Dark Mode, Materials, Color (developer.apple.com/design/human-interface-guidelines); WWDC25 "Meet Liquid Glass".
- WCAG 2.2 (w3.org/TR/WCAG22), WAI-ARIA APG disclosure & tabs patterns; NN/g progressive disclosure & skeleton screens.
- University of Twente Canvas dashboard redesign (n=95); University of Edinburgh Learn Ultra student UX research; William Paterson Blackboard Ultra student survey (n=1,104); EDUCAUSE 2025 USC student-centred LMS; Ohio State "Carmen Common Sense"; Phil Hill LMS survey analysis; Edinburgh "notification fatigue".
