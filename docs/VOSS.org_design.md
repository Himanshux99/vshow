# VOSS Labs — Shared UI & UX Design Specification

Version: 1.0 • Audited: 17 October 2026 • Scope: VOSS Labs websites and products

## 1. Purpose, evidence, and adoption

Use this document to keep VOSS Labs products consistent with the visual identity of [vosslabs.org](https://vosslabs.org/). It records the actual implementation and provides a practical extension for application interfaces.

**Evidence baseline:** [voss-labs/vosslabs.org](https://github.com/voss-labs/vosslabs.org), commit `2a7e70a6bddc5b593159d678063cf1f8d1cd54de`. Source CSS, Astro components, scripts, and SVG assets were inspected. The live desktop homepage was inspected in light and dark themes; the deployed stylesheet was also retrieved. Responsive measurements below come from source media queries, not a completed mobile-device usability audit. No claim is made that the live deployment is built from this exact commit.

**Status labels:**

- **Observed:** directly defined in the audited repository or observed on the live site.
- **Product standard:** a recommended reuse rule derived from that implementation.
- **Extension:** a proposed specification for patterns absent from the marketing website. These are not claims about existing VOSS products.

This is a proposed shared specification, not evidence of a previously approved organization-wide design system. Treat the observed core as the compatibility baseline; review extensions when adopting it.

### Quick implementation contract

1. Load **Geist** for interface text and **Geist Mono** for technical metadata, labels, and code.
2. Use the theme variables below. Primary buttons are neutral black/white; orange identifies the brand, selected navigation, and small emphasis.
3. Preserve warm off-white in light mode and near-black in dark mode.
4. Prefer thin dividers, flat surfaces, tight heading tracking, and small corner radii.
5. Reuse the row, bordered-grid, and panel structures described here.
6. Keep the same tokens across products; adapt content density and navigation to the task.
7. Do not reproduce inaccessible low-contrast labels or marketing-only cursor behavior in applications.

## 2. Design character

**Observed:** a typography-led, technical, editorial interface: large left-aligned headings, short descriptions, numbered sections, uppercase monospaced metadata, generous space, and horizontal rules. The orange square beside the wordmark and orange punctuation are recognizable brand details.

**Product standard:** hierarchy comes from type, spacing, alignment, and borders. Use orange selectively. Keep screens calm enough for repeated daily work. Avoid introducing gradients, decorative glows, oversized rounding, heavy card shadows, or a different default typeface. Syntax highlighting is an exception to the restrained UI palette.

### What remains consistent and what may adapt

| Keep consistent across products | Adapt to product needs |
| --- | --- |
| Fonts, neutral palettes, brand orange | Navigation destinations and application shell |
| Primary button treatment and focus outline | Page density, table columns, form structure |
| Small radii and 1px dividers | Dashboard/card arrangements |
| Type hierarchy and mono metadata | Domain-specific states and chart categories |
| Theme switching conventions | Marketing section heights versus compact app pages |
| Official marks and proportions | Product name and supporting description |

## 3. Color system

### 3.1 Core UI tokens — observed

Values below are from `src/styles/global.css`. Dark mode uses `[data-theme='dark']` on the root element. Tokens not overridden in dark mode inherit their light declaration.

| CSS token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--bg` | `#FAFAF7` | `#0A0A0A` | Page canvas |
| `--bg-elevated` | `#FFFFFF` | `#111111` | Raised surface color; not an instruction to add shadow |
| `--bg-card` | `#FFFFFF` | `#111111` | Bordered panel surface |
| `--bg-card-hover` | `#F5F4EF` | `#161616` | Available panel hover surface |
| `--border` | `#E6E4DD` | `#262626` | Subtle dividers and panel boundaries |
| `--border-hover` | `#C9C5BB` | `#404040` | Stronger separator / scrollbar |
| `--text` | `#0A0A0A` | `#FAFAFA` | Main text |
| `--text-dim` | `#525252` | `#A3A3A3` | Readable supporting text |
| `--text-muted` | `#A8A29E` | `#525252` | Original faint metadata; restricted for reuse below |
| `--accent` | `#0A0A0A` | `#FAFAFA` | Primary action fill; **not orange** |
| `--accent-light` | `#262626` | `#FFFFFF` | Primary action hover |
| `--accent-glow` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` | Declared token; do not infer a glow-based style |
| `--brand` | `#C4421D` | `#FB7A3C` | Theme-aware orange text, focus, selected state |
| `--brand-light` | `#E0541E` | `#FDA774` | Available lighter brand variant |
| `--brand-pure` | `#FB7A3C` | `#FB7A3C` | Stable logo square / brand detail |
| `--success` | `#0A0A0A` | `#FAFAFA` | Legacy neutral token; not a semantic success palette |
| `--hover-bg` | `rgba(0,0,0,0.035)` | `rgba(255,255,255,0.05)` | Row / ghost-action hover |
| `--code-bg` | `#F5F4EF` | `#161616` | Inline code surface |

### 3.2 Additional declared tokens — observed

| Token | Light | Dark | Implementation note |
| --- | --- | --- | --- |
| `--nav-bg` | `rgba(255,255,255,0.78)` | `rgba(10,10,10,0.7)` | Defined, but current Nav uses transparent then `--bg` |
| `--mobile-nav-bg` | `rgba(255,255,255,0.96)` | `rgba(10,10,10,0.95)` | Defined, but actual mobile menu uses opaque `--bg` |
| `--code-header-bg` | `rgba(0,0,0,0.02)` | `rgba(255,255,255,0.02)` | Available token; current code header inherits its panel |
| `--stats-bg` | `transparent` | inherited | No filled statistics block required |
| `--card-shadow` | `none` | inherited | Flat surface baseline |
| `--hero-code-shadow` | `none` | inherited | Flat code panel |
| `--grain-opacity` | `0` | `0.025` | Marketing background grain only |

Do not mistake the existence of a token for evidence that a component uses it.

### 3.3 Brand asset palette versus interface palette

`public/brand/tokens/colors.css` separately defines `--voss-ink: #0A0A0A`, `--voss-paper: #FAFAFA`, `--voss-accent: #FB7A3C`, and `--voss-muted: #737373`.

**Product standard:** use the global UI theme tokens for application surfaces and text. Use the brand asset palette for logos, export artwork, and social graphics. `#FAFAFA` brand paper is not the website's `#FAFAF7` light canvas. Do not replace theme-aware `--brand` with pure orange everywhere: its darker light-mode value is intentional and more legible.

### 3.4 Text contrast and reuse restrictions

Computed foreground/background contrast ratios, rounded for reporting:

| Pair | Ratio | Reuse decision |
| --- | --- | --- |
| Light `--text-dim` on `--bg` | 7.47:1 | Suitable supporting text |
| Dark `--text-dim` on `--bg` | 7.85:1 | Suitable supporting text |
| Light `--text-muted` on `--bg` | 2.41:1 | Do not use for information users need to read |
| Dark `--text-muted` on `--bg` | 2.53:1 | Do not use for information users need to read |
| Light `--brand` on `--bg` | 4.85:1 | Suitable normal-size brand text on this background |
| Dark `--brand` on `--bg` | 7.50:1 | Suitable normal-size brand text on this background |
| White on pure orange `#FB7A3C` | 2.64:1 | Do not use for standard button text |

**Product standard:** map readable metadata, timestamps, placeholders, and helper text to `--text-dim`. Retain the original muted values only for non-informational decoration or genuinely inactive controls. Do not assume secondary information is decorative. Test every actual foreground/background pair, including hover, selected, and disabled variants. Normal text should meet 4.5:1; qualifying large text can use 3:1. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### 3.5 Syntax palette — observed

These colors apply to code, not general navigation or status badges.

| Token | Light | Dark |
| --- | --- | --- |
| `--token-comment` | `#008000` | `#6A9955` |
| `--token-keyword` | `#7C3AED` | `#A78BFA` |
| `--token-bool` | `#0070C1` | `#569CD6` |
| `--token-string` | `#A31515` | `#CE9178` |
| `--token-function` | `#795E26` | `#DCDCAA` |
| `--token-variable` | `#001080` | `#9CDCFE` |
| `--token-property` | `#001080` | `#9CDCFE` |
| `--token-punct` | `var(--text-dim)` | `#D4D4D4` |

`--token-punct` exists in the repository but was absent from the inspected deployed CSS; treat it as a source declaration, not a verified live token. Comments in the code panels are italic. The source comments mention a logo gradient, but the inspected wordmark assets and site use flat fills; do not infer a gradient requirement.

## 4. Typography

### 4.1 Families and loading — observed

```css
--font-sans: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
```

Geist is loaded in weights `400, 500, 600, 700, 800, 900`; Geist Mono in `400, 500, 600`. Inter and JetBrains Mono are fallbacks, not separately loaded fonts. The website loads Google Fonts with `display=swap` and preconnects to `fonts.googleapis.com` and `fonts.gstatic.com`.

**Product standard:** ensure actual Geist files load rather than depending on a locally installed font. Self-hosting is acceptable with the same family and weights. Use sans for normal prose, form labels, buttons, and headings; mono for IDs, version numbers, technical labels, code, and navigation metadata. Avoid uppercase long-form text.

Base document size is `16px`; body line height is `1.55`, font smoothing is antialiased, and `font-feature-settings: 'ss01', 'cv11'` is set. Pixel equivalents below assume that 16px root. Preserve user zoom and font scaling.

### 4.2 Observed typography scale

| Role / selector | Family | Size | Weight | Line height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Hero `.hero-title` | Sans | `clamp(2.6rem,6.5vw,5.4rem)` = 41.6–86.4px | 600 | .96 | -.05em |
| Hero ≤900px | Sans | `clamp(2.2rem,7.5vw,3.4rem)` = 35.2–54.4px | 600 | .96 | -.05em |
| Hero ≤480px | Sans | `clamp(1.95rem,9.5vw,2.6rem)` = 31.2–41.6px | 600 | .96 | -.035em |
| Section title | Sans | `clamp(1.9rem,5.5vw,4rem)` = 30.4–64px | 600 | 1.05 | -.04em |
| Team section title override | Sans | `clamp(1.9rem,3.6vw,2.8rem)` = 30.4–44.8px | 600 | 1.05 | inherited -.04em |
| Manifesto | Sans | `clamp(2rem,5.5vw,4rem)` = 32–64px | 600 | 1 | -.045em |
| Focus row heading | Sans | `clamp(1.4rem,2.2vw,1.85rem)` = 22.4–29.6px | 600 | 1.15 | -.025em |
| Project/repo title | Mono | `clamp(1.1rem,1.6vw,1.4rem)` = 17.6–22.4px | 500 | inherited | -.01em |
| Value heading | Sans | `clamp(1.5rem,2.4vw,2rem)` = 24–32px | 600 | 1.1 | -.025em |
| Path card heading | Sans | 1.5rem / 24px | 600 | inherited | -.025em |
| Standards grid heading | Sans | 1.2rem / 19.2px | 600 | inherited | -.02em |
| Step / role heading | Sans | 1.05rem / 16.8px | 600 | inherited | -.02em |
| Hero description | Sans | 1.1rem / 17.6px | 400 | 1.55 | -.01em |
| Section description | Sans | `clamp(.98rem,1.6vw,1.125rem)` = 15.68–18px | 400 | 1.5 | -.01em |
| Row description | Sans | .96rem / 15.36px | 400 | 1.5 | normal |
| General path / values body | Sans | 1rem / 16px | 400 | 1.55 / 1.45 | normal |
| Step body | Sans | .9rem / 14.4px | 400 | 1.5 | normal |
| Role body | Sans | .88rem / 14.08px | 400 | 1.45 | normal |
| Section eyebrow | Mono | .72rem / 11.52px | 500 | inherited | .14em; uppercase |
| Hero eyebrow | Mono | .74rem / 11.84px | 500 | inherited | .12em; uppercase |
| Desktop navigation | Mono | .8rem / 12.8px | 500 | inherited | .06em; uppercase |
| Mobile navigation | Mono | .95rem / 15.2px | 500 | inherited | .1em; uppercase |
| Button | Sans | .92rem / 14.72px | 500 | inherited/browser context | -.01em |
| Large button | Sans | .95rem / 15.2px | 500 | inherited/browser context | -.01em |
| Hero code body | Mono | .82rem / 13.12px | 400 | 1.8 | normal |
| Terminal body | Mono | .78rem / 12.48px | 400 | 1.65 | normal |
| Inline code | Mono | .85em of parent | inherited | inherited | normal |

Additional original microtype: metadata labels `.65rem`, role tiers `.68rem`, path tags and updated timestamps `.7rem`, code-panel title `.75rem`. These are evidence of the marketing design, not recommended default form-label sizes.

### 4.3 Application scale — extension

| App role | Recommended size / line height | Weight |
| --- | --- | --- |
| Page title | 32px / 1.15; 28px on narrow layouts | 600 |
| Section title | 24px / 1.2 | 600 |
| Card title | 18px / 1.3 | 600 |
| Body / editable field | 16px / 1.5 | 400 |
| Compact table text | 14px / 1.5 | 400 |
| Form label / button | 14px / 1.4 | 500 |
| Helper / readable metadata | 12–14px / 1.5 | 400–500 |

Use `font-variant-numeric: tabular-nums` for counters and aligned metrics. Use natural title wrapping; do not force the marketing hero's two lines onto every product title.

## 5. Layout, spacing, geometry, and responsiveness

### 5.1 Observed shared dimensions

| Property | Value |
| --- | --- |
| Container | `max-width: 1320px; margin: 0 auto; padding: 0 32px` |
| Mobile container ≤768px | `padding: 0 20px` |
| Box model | `box-sizing: border-box` globally; 1320px includes container padding |
| Main section | `min-height: 100vh; padding: 80px 0; border-top: 1px solid var(--border)` |
| Main section ≤768px | Auto minimum height; `padding: 88px 0`; block layout |
| Section header | Maximum 720px; bottom margin 56px, then 40px ≤768px |
| Section description | Maximum 520px |
| Hero description | Maximum 480px; full width ≤900px |
| Typical row description | Maximum 680px |
| Small radius | `--radius-sm: 4px` |
| Default radius | `--radius: 6px` |
| Large radius | `--radius-lg: 8px` |
| Border width | 1px; active navigation underline 2px |
| Surface shadow | None |

The `section-alt` class currently resolves to the same `--bg`, not an alternating tinted section. The first `.section` of its type drops its top border.

### 5.2 Observed layout recipes

| Pattern | Desktop | Narrow layout |
| --- | --- | --- |
| Hero | `minmax(0,1.05fr) minmax(0,1fr)`, 80px gap | ≤900px: 1 column, 48px gap; padding 96px 0 64px |
| Manifesto | 160px label rail + content, 48px gap | ≤768px: 1 column, 24px gap; padding 64px 0 80px |
| Focus/project rows | 220px metadata rail + content, 40px gap | ≤768px: 1 column |
| Contribute | Equal columns, 56px gap | ≤900px: 1 column, 48px gap |
| Standards | 2 columns, shared borders, no gutter | ≤768px: 1 column |
| Team | Up to 360px diagram + content, 72px gap | ≤900px: 1 column, 56px gap |
| Values | 160px number rail + content, 40px gap | ≤768px: 1 column, 16px gap |
| Getting-started paths | Equal columns, shared borders | ≤768px: 1 column |
| Hero metadata | 2 equal columns, no gutter | Remains 2 columns in source |

**Observed breakpoints:** 900px for wide split layouts; 768px for navigation, shared containers, and most rows/grids; 600px for role rows and code-panel refinements; 480px for the smallest hero typography. These are max-width queries, so the boundary itself uses the narrower rule.

**Product standard:** reuse those breakpoints where they fit; change a component's breakpoint if content would otherwise collide. The site has no formal 12-column framework. Do not invent one as an existing requirement. Marketing `100vh` sections do not belong in dashboards or record-management pages.

### 5.3 Spacing scale — extension derived from recurring values

Use a shared 4px rhythm: `4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96px`. Source exceptions such as 10px icon gaps, 14px headers, 18px terminal padding, 22px button padding, and 36px path padding are intentional and may remain.

For products: 24–32px page vertical padding; 24px panel padding; 16–24px between fields; 8px label-to-input gap; 32–48px between major groups. Use 20px page gutters on mobile. Preserve readable content widths rather than stretching paragraphs across a dashboard.

## 6. Brand marks, icons, and decorative treatment

### 6.1 Wordmark — observed

Header: `VOSS`, Geist 800, 20px, tracking `-.045em`, line height 1. The orange square is 10×10px, separated by 4px and offset 3px from the bottom. Footer: 25.6px, weight 800, tracking `-.05em`, with a 12×12px square and the same gap/offset.

The shipped standalone SVG lockups use font weight 900; this differs from the live text wordmark's 800. Reuse the relevant implementation rather than silently making all marks identical.

Assets are in `public/brand/`:

| Folder / file family | Use |
| --- | --- |
| `logo/voss-lockup-light.svg`, `voss-lockup-dark.svg` | Main wordmark assets |
| `logo/voss-lockup-horizontal-*.svg`, `voss-lockup-stacked-*.svg` | Alternate composition assets |
| `logo/voss-mark*.svg`, `voss-monogram-*.svg` | Compact identity assets |
| `favicon/` | SVG/PNG icons, Apple icon, web manifest |
| `social/og-default.svg` and `.png` | Social preview artwork |
| `social/github-avatar.svg` and `.png` | Organization avatar artwork |

Inspected `*-lockup-light.svg` variants have dark lettering for light backgrounds; `*-lockup-dark.svg` variants have light lettering for dark backgrounds. Inspect the actual fill before choosing a mark: do not assume every filename's suffix describes the ink color. Some SVGs contain live `<text>` rather than outlined glyphs, so font availability can affect rendering. Use an approved outlined export if exact external rendering is essential.

**Product standard:** retain proportions, square shape, and pure orange. Allow at least one accent-square width of clear space around a mark (new reuse rule). Give the product name its own text treatment rather than redrawing the VOSS identity. Do not derive a product logo by stretching or adding effects to the master wordmark.

### 6.2 Icons — observed and reuse rule

Existing icons are inline SVGs: commonly 16px with 1.5–2px strokes, round caps/joins; some vendor icons are solid. Repository stars are 12px. The theme glyph is 16px inside a 24px desktop control.

**Product standard:** choose one coherent icon family that matches this style; use 16px inline, 20px in ordinary toolbars, 24px when larger affordances need it. These latter sizes are extensions. Use `currentColor`. Hide decorative icons from assistive technology and label icon-only controls. Enlarge hit areas independently of glyph size.

### 6.3 Optional marketing effects — observed

Dark mode has a fixed grain overlay with opacity `.025`, pointer events disabled, and a 256px repeating SVG texture. Light mode has zero grain. A custom orange square cursor grows from 12px to 28px over interactive/decorative hover targets and follows the pointer with easing `.22`; it is enabled for fine pointers with hover. Both effects use z-index 9999.

**Product standard:** omit both effects from operational applications by default. Keep native cursor feedback for text editing, resizing, drag operations, and disabled controls. These effects are optional marketing personality, not required brand foundations.

## 7. Component specifications

### 7.1 Navigation — observed

Fixed full-width top bar, 64px inner height, z-index 100, 1px bottom border. Starts transparent and becomes `--bg` after scrolling more than 50px. No blur/glass effect in the current navigation implementation. Desktop links have 28px gaps and 6px vertical padding. A 1×16px separator divides link groups.

Default link: `--text-dim`; hover: `--text`; active: `--brand` plus 2px underline. Active section tracking applies `aria-current="location"`. The GitHub CTA is a text link with an arrow, not a filled button. Account is a link to the separate account origin, not an embedded account form.

At ≤768px: a 22px three-line hamburger opens a fixed full-screen menu; padding is `96px 24px 40px`. Menu links have 22px vertical padding and bottom rules; theme control becomes a 64px-high row. Body scrolling is locked. The menu fades/translates over 300ms; choosing a navigation link closes it. Menu z-index is 200 within navigation, toggle 210.

**Product extension:** use `aria-current="page"` for routed product pages. Provide Escape-to-close, focus placement, focus containment for modal navigation, and focus restoration; the current mobile menu script does not implement these fully. Do not copy its explicit toggle blur as a keyboard interaction standard. Add `aria-controls` and an accessible expanded state.

### 7.2 Buttons — observed

| Variant | Geometry | Rest | Hover |
| --- | --- | --- | --- |
| Primary | 12px 22px padding; 4px radius; 1px border; 10px icon gap | `--accent` fill/border, `--bg` text | `--accent-light` fill/border |
| Ghost / outline | Same | Transparent, `--text`, `--border` | `--hover-bg`, border `--text` |
| Large | 14px 28px padding; 15.2px type | Same variant colors | Same variant behavior |

Transitions: color, background, border in 200ms using shared easing. The final SVG shifts right 3px on hover; pressed state translates down 1px. The existing CSS has no explicit shared button height or line height, so do not present an inferred height as a source token.

**Product extension:** set a consistent line height (1.4) and minimum 44px control height for primary touch actions. Support disabled, loading, and focus states. A loading button preserves its width, communicates progress, and prevents duplicate submission. Disabled is non-interactive with an explicit reason where needed; opacity alone is not enough. Use `<button>` for actions and `<a>` for destinations. Prefer one primary action per task area.

### 7.3 Text links — observed

Body action links use `--brand`, weight 500, a 1px brand underline, and 2px bottom padding. Repository-list footer links use mono 13.6px, uppercase, `.06em` tracking, neutral text, and a subtle underline that turns brand-colored on hover. External arrows use `↗`; directional arrows use `→` or matching SVGs.

**Product standard:** links embedded in paragraphs remain visibly identifiable without hover. Do not make a non-interactive card look clickable. Avoid nested links/buttons inside a whole-card anchor.

### 7.4 Editorial row / project card — observed

This is the main card pattern: a flat full-width row, not a floating tile. Parent list has a top rule; each row has a bottom rule. There is no outer rounding, shadow, or gap between rows.

- Desktop grid: `minmax(0,220px) 1fr`; gap 40px; padding `28px 0`.
- Left rail: number then category/language; 12px internal gap; 6px top padding.
- Right side: title, description, optional metadata/action footer.
- Focus-area heading uses sans; repository name uses mono.
- Project title and stars share a baseline; header gap 16px; stars do not shrink.
- Project body has 10px vertical gap. Header/footer max width 720px; description max width 680px. Footer starts 4px below its ordinary gap.
- Project hover: `--hover-bg` row, brand-colored title, arrow shifts `2px,-2px`.
- ≤768px project rows: single column, 14px gap, `32px 0` padding; number and language become a horizontal row.
- ≤768px focus rows: single column, 16px gap, `36px 0` padding.

**Product standard:** use this for navigable lists of projects, resources, and records with descriptive context. If a row contains multiple actions, use a semantic row/container with separate controls rather than making the entire row one link. Important record metadata uses readable `--text-dim`.

### 7.5 Shared-border grid card — observed

Standards grid: two columns with no gutter. Parent owns top and left borders; cells own right and bottom borders to avoid doubled rules. Cells have 24px padding and square corners. Header aligns a mono number and sans 19.2px/600 title on the baseline with a 14px gap; body begins 12px below. Body is 15.2px with line height 1.55. Stacks to one column ≤768px.

Getting-started path cards use the same shared-border concept with 36px padding. Header-to-body gap 24px; orange uppercase mono tag at 11.2px with 12px bottom margin; title 24px/600. Ordered steps indent 36px, use leading-zero numbers, and have 16px bottom gaps. On mobile cells use `32px 0` and remove the right border; the source retains the parent's left border. For a new product, resolve that asymmetry intentionally rather than assuming it is a required style.

### 7.6 Code / terminal panel — observed

`--bg-card`, 1px `--border`, 4px radius, clipped outer corners, no shadow. Header padding `10px 16px`, 1px bottom rule. Hero panel title is 12px mono; terminal title 11.52px mono.

Hero code body: `18px 20px` padding, 13.12px mono, line height 1.8, minimum 184px height. Terminal body: `16px 18px`, 12.48px mono, line height 1.65; ≤600px it uses 11.52px and 14px padding. Code scrolls horizontally inside the panel; scrollbar is 6px with a `--border-hover` thumb.

**Source nuance:** nested `<code>` resets background, padding, family, border, and color, but does not reset the global `.85em` font size. Its effective text can therefore be smaller than the `<pre>` value. **Product standard:** explicitly use `pre code { font-size: inherit; }` when adopting the intended panel scale.

Inline code uses `--code-bg`, 1px border, 4px radius, `2px 6px` padding, mono `.85em`. Avoid wrapping long tokens in a way that forces page-wide overflow.

### 7.7 Metadata / description list — observed

Hero metadata is a two-column `<dl>` with top border and shared cell separators. Cells have 16px vertical padding; odd cells add 16px right padding and a right border; even cells add 16px left padding. Last two cells omit their bottom border. Labels: mono 10.4px, uppercase, `.14em`, 6px bottom margin. Values: sans 15.2px/500, `-.01em`.

**Product extension:** use at least 12px readable labels and 14–16px values for operational records; collapse columns if long values demand it. Do not truncate important identifiers without a way to inspect/copy them.

### 7.8 Steps, roles, and diagram — observed

Steps: 18px vertical padding, 20px gap, number rail minimum 36px, dividing rules. Number 11.52px mono/500; heading 16.8px/600; description 14.4px.

Role rows are real buttons with three columns `32px 100px 1fr`, 20px column gaps, 4px row gap, and 14px vertical padding. Description aligns beneath the name. Hover/active adds 8px left padding. ≤600px the layout uses `32px 1fr`, stacking tier/name/body. Focus on a role row highlights its corresponding diagram node, as does hover.

Team diagram: maximum 360px wide, sticky at 96px on desktop; ≤900px it becomes static, centered, max 320px. Thin neutral ring/spokes and brand-orange active nodes. The textual role list provides the keyboard route; SVG pointer hover alone must not be the only route to information.

### 7.9 Footer — observed

Top border; `96px 0 48px` padding. Brand and two link columns sit in a wrapping flex row with 40px gap; link groups have 64px gap. Main footer group ends with 64px margin. Bottom metadata begins after a rule and 36px padding. ≤768px groups and bottom metadata stack; link-group gap becomes 40px.

**Product standard:** marketing footer belongs on public pages. Signed-in applications may use a smaller help/version footer; retain typography and color, not the full marketing footprint.

### 7.10 Optional game — observed, not required for products

The hero code card can become a snake game. It keeps a 184px stage height to avoid shifting the panel. Source states are `static`, `idle`, `playing`, `paused`, and `dead`; UI includes play, close, resume, and restart controls. Arrow/WASD keys control play; space pauses; Escape closes. A translucent card-colored overlay uses a 2px blur. This is an optional brand interaction, not a shared business-workflow component.

## 8. UX, theme behavior, and motion

### 8.1 Theme behavior — observed

The root attribute is `data-theme="dark"`; light removes it. A stored `voss-theme` preference wins over the OS preference. With no saved preference, system dark mode is checked on load. An early inline script applies dark mode before paint; a later script updates icons and handles the toggle. Toggling persists the preference. Live response to later OS-theme changes is not implemented in the audited script.

**Product standard:** keep the same colors and preference meaning. Implement persistence defensively so storage failure cannot break navigation. If adding a System option, explicitly support OS change events while System is selected. `localStorage` is origin-specific: using the same key does not automatically synchronize preferences across VOSS subdomains. Use a deliberate shared account preference if cross-product sync is required.

### 8.2 Motion values — observed

| Interaction | Timing / behavior |
| --- | --- |
| Shared easing | `cubic-bezier(.4,0,.2,1)` |
| Button/link/row color and arrow feedback | 200ms |
| Theme body background/text | 300ms |
| Component surface/border changes | Commonly 350ms |
| Mobile menu | 300ms, opacity + translateY(-12px → 0) |
| Scroll reveal | 500ms, opacity 0 → 1, translateY(16px → 0) |
| Reveal trigger | Intersection threshold .12; bottom root margin -40px; once only |
| Hero reveal | Starts 200ms; 120ms per observed hero element |
| Repeated item stagger rules | Commonly 60ms increments; roles 50ms |
| Same-page navigation | Smooth scroll with 80px offset |

**Product standard:** motion should clarify feedback, not delay access to data. Do not apply scroll-reveal hiding to tables, forms, or essential app content. Stagger selectors in the CSS do not imply every listed child currently carries `data-reveal`.

The existing reduced-motion rule makes CSS transitions/animations near-instant and reveals content, but does not fully suppress JavaScript smooth scrolling or the animation-frame cursor loop. New products should also disable smooth scrolling, decorative loops, and nonessential transforms when reduced motion is requested.

### 8.3 Interaction states — product standard / extension

Every reusable interactive component needs explicit rest, hover, keyboard-focus, active/selected, disabled, and loading behavior. Treat focus independently of hover. Indicate selection through a line, icon, or label as well as color. Prevent duplicate saves; confirm success next to the relevant task. Keep entered data when a request fails.

For destructive actions, describe the exact item and consequence; provide cancel and undo where feasible. For empty views, explain whether there is no data or no matching result and offer one relevant next action. Errors should identify the problem and a useful recovery step. Avoid replacing whole pages with generic failure messages when the rest remains usable.

### 8.4 Voice and content — product standard

Use direct, concrete headings and action verbs. Keep labels short, use sentence case for product prose, and reserve uppercase for brief mono metadata. Prefer “Add item”, “Save changes”, “Download report”, and “Try again” to vague action labels. Say what happened and what the user can do next. Technical humor from the game is optional; errors in important workflows must remain unambiguous.

Use the organization name consistently in product attribution. Do not transfer marketing promises such as contribution review times into product service guarantees.

## 9. Application components not defined by the source — extensions

The audited site is an Astro marketing site, not a full React/ShadCN component library. It does not establish general forms, data tables, dialogs, toasts, authentication screens, charts, or semantic status palettes. The following are proposed defaults designed to fit its identity.

| Component | Proposed visual contract | Required UX behavior |
| --- | --- | --- |
| Application shell | 64px top bar; optional 240px sidebar; 24–32px content padding; 20px mobile gutters | Responsive drawer; route-aware nav; visible product title |
| Standard app panel | `--bg-card`, 1px `--border`, 6px radius, 24px padding, no shadow | Header → description → content → optional actions; no arbitrary fixed height |
| Input / select | Minimum 44px high; 16px text; 10px 12px padding; 4px radius; `--bg-card` surface | Visible label; help/error association; proper keyboard behavior |
| Input boundary | `--text-dim` when the outline is needed to identify the control | Original subtle card border is too faint to be the only control boundary |
| Textarea | Same field styling, minimum 120px high, vertical resize | Preserve input, show limit/count when useful |
| Checkbox / radio | Approximately 18px visual control inside a generous label target | Native semantics; visible checked state and focus |
| Tabs | 14px/500; neutral labels; 2px active brand underline; 12–16px padding | Keyboard tab pattern; separate route links from in-page tabs |
| Status badge | Mono 12px/500, 4px radius, 2px 8px padding, border; plain neutral default | Text plus optional icon; never color alone |
| Data table | Sans 14px body; mono 12px header where useful; 12px 16px cell padding; 1px row rules | Sort state, explicit row selection, predictable actions, accessible headers |
| Table density | Approximately 48px rows by default; 40px only when justified | Touch controls retain usable targets; long content may increase height |
| Dialog | `--bg-card`, 1px border, 8px radius, 24px padding; max 560px, 20px mobile margin | Named dialog, focus containment/return, Escape when safe, cancel action |
| Popover/menu | Card surface, 1px border, 6px radius, 4–8px padding; no decorative glow | Keyboard navigation, dismiss behavior, collision-safe positioning |
| Toast | Compact bordered card, 14px text, icon + message + optional action | Announce status appropriately; do not rely on toast alone for critical errors |
| Empty state | Quiet title, concise body, one relevant action, restrained optional icon | Differentiate no data / no results / unavailable |
| Skeleton | Existing neutral surface colors, same geometry as loaded content | No flashing; reduced-motion static; accessible loading status |
| Pagination | Neutral buttons, current page in primary/selected treatment | Label previous/next; preserve sorting and filters |
| Charts | Neutral axes; orange primary series; readable mono values | Label series directly or provide legend; distinguish series beyond color |

### Semantic colors — extension

The source's neutral `--success` is not suitable as a complete status system. For a product that needs status colors, introduce namespaced tokens rather than changing the legacy token silently. Suggested foreground colors below are for status text/icons on the standard page/card surfaces; recheck contrast if you introduce filled badges.

| Proposed token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--status-success` | `#166534` | `#86EFAC` | Completed / available |
| `--status-warning` | `#854D0E` | `#FDE047` | Needs attention |
| `--status-danger` | `#B91C1C` | `#FCA5A5` | Error / destructive consequence |
| `--status-info` | `#1D4ED8` | `#93C5FD` | Informational state |

Keep these colors within status or data visualization contexts. They do not replace the VOSS brand orange or the monochrome primary action. A destructive button may use the danger foreground/background pair with independently verified contrast; do not assume white text works for every dark-mode danger fill.

### Product page recipes — extension

- **List page:** title + concise description + one primary action; search/filter toolbar; rows or table; pagination; empty/error/loading states.
- **Detail page:** breadcrumb/back link; title + status; description list of attributes; primary content; contextual actions; change/activity history when useful.
- **Create/edit page:** clear title; grouped fields in a readable-width column (suggested max 720px); inline validation; cancel/save row; warn before losing unsaved edits.
- **Overview page:** compact page heading; small shared-border metrics grid; main list/table; secondary details only if they support decisions. Avoid viewport-height empty sections.
- **Authentication page:** restrained branded panel; readable form; clear pending/error states. Product identity and auth navigation should feel consistent without assuming shared session or cross-origin architecture.

## 10. Accessibility and robustness requirements for reuse

These are product requirements, not a claim that the audited site meets every requirement.

1. Use one meaningful page H1 and logical heading levels; do not copy a component's H4 if it would skip your hierarchy.
2. Preserve the skip link. The source uses a fixed high-contrast link at top/left 8px, shown on focus, z-index 200.
3. Keep `:focus-visible` at 2px `--brand`, 2px offset, 4px radius. Navigation uses 4px offset. Ensure the ring is not clipped.
4. Use readable text contrast. Do not copy faint metadata colors to labels, timestamps, placeholder text, or helper copy.
5. Maintain at least the WCAG 2.2 AA target-size requirement of 24×24 CSS pixels or a permitted exception; prefer 44×44px for touch controls. The 44px choice is this document's product recommendation, not the AA minimum. See [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
6. Do not hide essential content behind JavaScript-only reveal classes. Start visible and progressively enhance when animation initialization succeeds.
7. Give form controls accessible names and associated errors; placeholders are not labels. Status updates should be announced without repeatedly stealing focus.
8. Support keyboard-only use of menus, tabs, dialogs, row actions, and theme switching. Ensure focus is visible and never trapped unintentionally.
9. Respect reduced motion in both CSS and JavaScript. Essential actions must not depend on pointer animation or hover.
10. Test at 200% zoom, long text, narrow screens, and both themes. Preserve local scrolling for code/tables rather than hiding page-wide overflow to conceal layout bugs.
11. Do not use the marketing site's low-contrast divider as the only means of identifying an interactive input or selected state. Add a sufficient-contrast boundary or other clear affordance.
12. Keep stable layouts while content loads; reserve dimensions for icons and panels, and avoid shifting action buttons during submission.

## 11. Implementation reference

### 11.1 Drop-in foundation tokens

The following block reproduces the audited source token declarations, including legacy/unused tokens for fidelity. It is not the complete website stylesheet. Apply the reuse restrictions above when building components.

```css
/* Design tokens — light is default (Vercel/font feel) */
:root {
  --bg: #fafaf7;
  --bg-elevated: #ffffff;
  --bg-card: #ffffff;
  --bg-card-hover: #f5f4ef;
  --border: #e6e4dd;
  --border-hover: #c9c5bb;
  --text: #0a0a0a;
  --text-dim: #525252;
  --text-muted: #a8a29e;
  --accent: #0a0a0a;
  --accent-light: #262626;
  --accent-glow: rgba(0, 0, 0, 0.06);
  --success: #0a0a0a;
  --brand: #c4421d;
  --brand-light: #e0541e;
  --brand-pure: #fb7a3c;
  --font-sans: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 8px;
  --max-width: 1320px;
  --transition: cubic-bezier(0.4, 0, 0.2, 1);
  --nav-bg: rgba(255, 255, 255, 0.78);
  --mobile-nav-bg: rgba(255, 255, 255, 0.96);
  --hover-bg: rgba(0, 0, 0, 0.035);
  --code-header-bg: rgba(0, 0, 0, 0.02);
  --stats-bg: transparent;
  --card-shadow: none;
  --hero-code-shadow: none;
  --code-bg: #f5f4ef;
  --grain-opacity: 0;
  /* VS Code Light theme syntax — keyword pulls from logo gradient */
  --token-comment: #008000;
  --token-keyword: #7c3aed;
  --token-bool: #0070c1;
  --token-string: #a31515;
  --token-function: #795e26;
  --token-variable: #001080;
  --token-property: #001080;
  --token-punct: var(--text-dim);
}

[data-theme='dark'] {
  --bg: #0a0a0a;
  --bg-elevated: #111111;
  --bg-card: #111111;
  --bg-card-hover: #161616;
  --border: #262626;
  --border-hover: #404040;
  --text: #fafafa;
  --text-dim: #a3a3a3;
  --text-muted: #525252;
  --accent: #fafafa;
  --accent-light: #ffffff;
  --accent-glow: rgba(255, 255, 255, 0.08);
  --success: #fafafa;
  --brand: #fb7a3c;
  --brand-light: #fda774;
  --nav-bg: rgba(10, 10, 10, 0.7);
  --mobile-nav-bg: rgba(10, 10, 10, 0.95);
  --hover-bg: rgba(255, 255, 255, 0.05);
  --code-header-bg: rgba(255, 255, 255, 0.02);
  --code-bg: #161616;
  --grain-opacity: 0.025;
  /* VS Code Dark+ theme syntax — keyword pulls from logo gradient */
  --token-comment: #6a9955;
  --token-keyword: #a78bfa;
  --token-bool: #569cd6;
  --token-string: #ce9178;
  --token-function: #dcdcaa;
  --token-variable: #9cdcfe;
  --token-property: #9cdcfe;
  --token-punct: #d4d4d4;
}
```

### 11.2 Product-safe base — proposed adaptation

```css
*, *::before, *::after { box-sizing: border-box; }
html { font-size: 100%; }
body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  line-height: 1.55;
  font-feature-settings: 'ss01', 'cv11';
  -webkit-font-smoothing: antialiased;
}
button, input, textarea, select { font: inherit; }
:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
.voss-container {
  width: 100%;
  max-width: var(--max-width);
  margin-inline: auto;
  padding-inline: 32px;
}
.voss-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  box-shadow: none;
}
.voss-helper { color: var(--text-dim); }
pre code { font-size: inherit; }
@media (max-width: 768px) {
  .voss-container { padding-inline: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    transition-delay: 0ms !important;
  }
}
```

Scope reusable styles to components. The original site's global code/button/link rules can unexpectedly style embedded widgets or component-library internals. Prefer semantic tokens in component styles to copied hex values.

### 11.3 React / Vite / TypeScript / ShadCN integration — extension

This is an integration map, not a claim that the reference website uses ShadCN. Keep one shared token stylesheet and reusable components. A component library supplies behavior/structure; override its defaults so its own font, colors, radii, and shadows do not replace VOSS styling.

| Consumer token | VOSS mapping |
| --- | --- |
| Background / foreground | `var(--bg)` / `var(--text)` |
| Card / card foreground | `var(--bg-card)` / `var(--text)` |
| Popover / foreground | `var(--bg-elevated)` / `var(--text)` |
| Primary / primary foreground | `var(--accent)` / `var(--bg)` |
| Primary hover | `var(--accent-light)` |
| Secondary / secondary foreground | `var(--bg-card-hover)` / `var(--text)` |
| Muted surface / muted foreground | `var(--code-bg)` / `var(--text-dim)` |
| Consumer-library accent / accent foreground | `var(--hover-bg)` / `var(--text)` |
| Decorative border | VOSS `--border` |
| Input boundary | `var(--text-dim)` when boundary is the affordance |
| Focus ring | `var(--brand)` |
| Radius | 6px base; buttons/inputs 4px; dialogs 8px |
| Destructive | Explicit status extension with verified foreground pairing |

**Naming collision:** VOSS `--accent` means primary action fill. A component library may use `--accent` for hovered menu items. Do not overwrite one with the other, and never create self-references such as `--border: var(--border)`. Rename the VOSS tokens to a consistent prefix (for example `--voss-ui-accent`, `--voss-ui-border`) before defining same-named consumer aliases. Update all corresponding dark overrides too.

The exact alias syntax depends on the installed consumer theme format. If it expects channel-only HSL, convert values accordingly; if it accepts complete CSS colors, use complete values. Do not wrap an already-complete hex/var color in `hsl()`. Apply whichever dark class/attribute the consumer requires together with the canonical VOSS theme state; do not let the two drift.

### 11.4 Suggested shared component inventory — extension

`PageContainer`, `AppHeader`, `SectionHeader`, `Button`, `IconButton`, `InlineLink`, `EditorialRow`, `BorderedGrid`, `Panel`, `MetadataList`, `CodePanel`, `Field`, `StatusBadge`, `DataTable`, `EmptyState`, `Dialog`, and `ThemeToggle`.

Keep variant dimensions in shared components. A single token change should update all consumers without a screen-by-screen edit. Do not duplicate the homepage's scoped `.row` styles into many unrelated screens.

## 12. Acceptance checklist for a new VOSS product

- [ ] Actual Geist and Geist Mono fonts load; fallbacks do not silently become the default.
- [ ] Light/dark colors match the token tables; light canvas is `#FAFAF7`.
- [ ] Primary actions are monochrome; brand orange is used deliberately.
- [ ] No unapproved gradient, glow, oversized radius, or card shadow changes the visual identity.
- [ ] Rows, grids, panel padding, borders, and heading tracking match the chosen recipes.
- [ ] Marketing hero sizes and viewport-height sections are not copied into operational pages.
- [ ] Every interactive element has keyboard focus, hover, disabled, loading, and selected states where relevant.
- [ ] Labels, timestamps, helper text, and error states are readable in both themes.
- [ ] Touch targets, mobile menu focus behavior, and narrow layouts are usable.
- [ ] Page content remains available if reveal animation or optional scripts fail.
- [ ] Reduced motion works for CSS and JavaScript behavior.
- [ ] Tables/forms handle empty, loading, validation, failure, and long-content states.
- [ ] Theme preference persists without a flash; cross-origin sync is not assumed.
- [ ] Brand assets retain proportions and use the correct contrast variant.
- [ ] Visual review covers approximately 360px, 768px, 900px, and 1440px widths, plus 200% zoom.
- [ ] Any new status colors/components are documented as extensions and reviewed before reuse.

## 13. Source map and maintenance

Repository links below are pinned to the audited commit so later source changes do not silently alter this document's evidence.

| Source | Evidence |
| --- | --- |
| [src/styles/global.css](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/styles/global.css) | Colors, typography primitives, buttons, focus, spacing, motion |
| [src/layouts/Layout.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/layouts/Layout.astro) | Font loading, theme initialization, skip link, metadata |
| [src/scripts/site.ts](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/scripts/site.ts) | Theme persistence, navigation, reveal, smooth scrolling |
| [src/components/Nav.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Nav.astro) | Header, wordmark, desktop/mobile navigation |
| [src/components/Hero.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Hero.astro) | Hero typography, layout, metadata |
| [src/components/FocusAreas.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/FocusAreas.astro) | Editorial content rows |
| [src/components/Projects.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Projects.astro) | Linked project rows and hover states |
| [src/components/Contribute.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Contribute.astro) | Step list, terminal, action strip |
| [src/components/Standards.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Standards.astro) | Shared-border grid cards |
| [src/components/Team.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Team.astro) | Interactive role rows and SVG diagram |
| [src/components/Values.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Values.astro) | Numbered values rows |
| [src/components/GettingStarted.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/GettingStarted.astro) | Path cards and ordered steps |
| [src/components/Manifesto.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Manifesto.astro) | Oversized statement layout |
| [src/components/Footer.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Footer.astro) | Footer structure and identity |
| [src/components/SnakeGame.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/SnakeGame.astro) | Code panel and optional game states |
| [src/components/BackgroundFx.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/BackgroundFx.astro) | Grain overlay |
| [src/components/Cursor.astro](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/src/components/Cursor.astro) | Optional custom pointer |
| [public/brand/tokens/colors.css](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/public/brand/tokens/colors.css) | Separate brand asset palette |
| [public/brand/logo/voss-lockup-light.svg](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/public/brand/logo/voss-lockup-light.svg) | Standalone wordmark proportions |
| [public/brand/logo/voss-lockup-horizontal-dark.svg](https://github.com/voss-labs/vosslabs.org/blob/2a7e70a6bddc5b593159d678063cf1f8d1cd54de/public/brand/logo/voss-lockup-horizontal-dark.svg) | Light lettering for dark backgrounds |

Additional references: [live website](https://vosslabs.org/), [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C target sizes](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

### Audit observations to carry forward

- Source and live UI agree on the core palette, fonts, large hero treatment, and theme appearance inspected. The deployed stylesheet omits the source `--token-punct` declaration; exact source/deployment parity is not asserted.
- Brand assets have a separate four-color palette; do not substitute those tokens for the interface theme wholesale.
- Several declared color tokens are unused by the current navigation/panel selectors.
- Muted metadata colors fall below ordinary text contrast requirements; use the readable adaptation for products.
- The original menu needs more complete keyboard focus handling for reuse in applications.
- Reduced-motion handling needs JavaScript coverage; the custom cursor should remain optional.
- Forms, tables, dialogs, semantic statuses, and app shells in this document are proposed extensions, not extracted components.

### Change policy — proposed

Store this `design.md` alongside each product's development documentation or reference a versioned shared copy. Keep tokens in one shared package when multiple products adopt them. Record the source commit, document version, changed tokens/components, migration instructions, and visual-review evidence for each update. Review palette/font/radius changes centrally; do not introduce product-specific replacements under the same token name. If a new product needs a distinct pattern, document the reason and reuse the existing foundations.

### Changelog

- **1.0 — 2026-10-17:** Initial source-based extraction and live desktop verification; added clearly separated product extensions, accessibility adaptations, integration mappings, and an implementation checklist.
