# Story — Applicant Dashboard Landing Page Graphic

**Parent:** [story-applicant-warm-welcome-dashboard.md](./story-applicant-warm-welcome-dashboard.md)
**Status:** Approved
**Priority:** Medium
**Type:** UI Asset / Brand Identity

---

## Context

The login page needs a hero illustration that:
1. Reinforces the **New Frontier** brand identity
2. Communicates the core value proposition: **guiding job seekers through their career journey**
3. Feels premium and trustworthy — not generic or cartoonish
4. Works across viewport sizes and contexts

After exploring multiple directions (human-illustrated hero, abstract gradient, pure UI mockup), Option B was selected: a **dark-mode isometric brand illustration** with geometric precision, frosted glass UI panels, and a career-journey data visualization.

---

## Design Direction

### Aesthetic: Premium Dark-Mode SaaS

**Reference sites:** Linear, Vercel, Pitch, Stripe Atlas, Arc Browser
**Design language:** Isometric 2.5D, geometric precision, glassmorphism, no cartoon characters, data-informed

### Color Palette

```
Background:
  - Midnight:     #0D0F1A   (deepest bg)
  - Surface:      #131628   (card/panel bg)
  - Elevated:     #1A2035   (isometric plane)

Accent:
  - Emerald:      #3DAA6C   (primary brand — growth, progress)
  - Emerald dark: #2D8A52   (hover/pressed)
  - Gold:         #D4A84B   (milestones, destinations)
  - Gold dark:    #B8923A   (gold hover)

Text:
  - Primary:      #FFFFFF   (opacity 0.85)
  - Secondary:    #8A9AAA   (labels, secondary info)
  - Muted:        #6A7A8A   (captions)

Utility:
  - Glass fill:   rgba(255,255,255,0.08) → 0.02
  - Glass border: rgba(255,255,255,0.25) → 0.05
```

### Typography

```
Brand wordmark: -apple-system, Segoe UI, Roboto
  - "NEW FRONTIER" — 13px, weight 700, letter-spacing 0.3em, white 0.85
  - Sub-tagline   — 9px,  weight 400, letter-spacing 0.15em, muted

Card labels: 8px, secondary color
Chart labels: 8px, emerald for active milestones
```

### Visual Concept

The illustration encodes the applicant's experience as a **data story**:

1. **Centerpiece — Isometric compass gem**
   - Hexagonal platform in deep midnight
   - Emerald outer ring, dark face, thin tick marks
   - Needle pointing toward horizon (NE / destination)
   - Gold center jewel
   - Sits on an isometric floor plane with shadow

2. **Journey line — Precision Bézier curve**
   - Not a literal path — a **data visualization** of application progress
   - Four milestones: Applied → Reviewed → Interview → Offer
   - Active cursor dot at current position (Interview stage)
   - Subtle area fill under curve (6% opacity emerald)
   - Faint horizontal grid lines for tech precision feel

3. **Frosted glass UI cards — four floating panels**
   - Application status card (top-left): avatar + status pill + progress bar
   - Job listing preview (top-right): company logo placeholder + tags + save icon
   - Profile completeness (bottom-left): avatar + circular progress ring (75%)
   - Activity feed (bottom-right): notification dots with text lines

4. **Supporting elements**
   - Subtle dot grid (40px spacing, 1px dots, 4% white opacity) — tech/precision feel
   - Emerald + gold diamond accents (geometric, not decorative)
   - Connecting dashed line from compass to chart
   - Ambient radial glows (bottom-right green, top-left purple)
   - Brand wordmark at bottom: "NEW FRONTIER" + "CAREER JOURNEY PLATFORM"

### What the illustration does NOT contain

- No cartoon characters, people, or avatars (aside from abstract UI avatars)
- No literal mountains, sun, or landscape
- No bright saturated gradients (coral, orange, pink)
- No playful shapes or starburst decorations
- No thick outlines or cartoon-style strokes
- No flat pastel backgrounds

---

## Implementation Details

### File

```
public/images/frontier-illustration.svg
```

### SVG Structure

```
<svg viewBox="0 0 800 480">
  <defs>
    gradients, filters, clipPaths
  </defs>
  <rect>          background (dark gradient)
  <rect>          ambient glows
  <g>             dot grid pattern
  <g>             isometric floor plane
  <g>             compass (platform + ring + needle)
  <g>             journey line (path + milestones + labels)
  <g>             frosted glass cards (x4)
  <g>             floating accent elements
  <text>          brand wordmark
</svg>
```

### Responsive Behavior

| Viewport | Treatment |
|---|---|
| Full-width hero (>800px) | SVG at native size |
| Medium (480-800px) | Scale to 90% container width |
| Mobile (<480px) | Reduce to 60% width, cards stack below |

The compass and chart remain legible at all sizes. Cards scale proportionally.

### Performance

- Single SVG file — no external images
- No JavaScript required
- `opacity` animations should be avoided inside SVG for accessibility (static asset)
- Target: <50KB file size
- Load strategy: inline in EJS template `<%= %>` for hero section

---

## Placement in the Application

### Login Page (`views/dashboard/login.ejs`)

The illustration appears above the form:

```html
<section class="login-hero">
  <img
    src="/images/frontier-illustration.svg"
    alt="New Frontier — guiding your career journey"
    class="login-hero__graphic"
    width="800"
    height="480"
  />
</section>
```

### CSS (login page specific)

```css
.login-hero {
  background: linear-gradient(160deg, #0D0F1A 0%, #131628 100%);
  padding: 48px 32px 32px;
  border-radius: 16px 16px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-hero__graphic {
  max-width: 100%;
  height: auto;
  max-height: 360px;
  object-fit: contain;
}
```

### Dark form card background

The login form card below the hero should continue the dark background:

```css
.login-card {
  background: linear-gradient(160deg, #131628 0%, #1A1D35 100%);
  /* glass border */
  border: 1px solid rgba(255,255,255,0.08);
}
```

---

## Accessibility

| Concern | Approach |
|---|---|
| `role="img"` + `aria-label` | Present on `<svg>` root |
| `<title>` | Short: "New Frontier" |
| `<desc>` | Describes all visual elements |
| Color contrast | Emerald/gold on dark — WCAG AA compliant |
| No text in SVG (aside from brand wordmark) | Text is SVG text, not rasterized |
| Reduced motion | No animation in static SVG; CSS `@media (prefers-reduced-motion)` for page transitions |

---

## Future Extensibility

### If brand colors change

Update only the gradient definitions in `<defs>`:
- `#3DAA6C` (emerald) → new primary
- `#D4A84B` (gold) → new milestone color

### If we add a light-mode variant

Swap the SVG for a light-mode equivalent — same structure, inverted palette:
- Background: `#F8F9FA`
- Surface: `#FFFFFF`
- Accent emerald stays, text becomes dark

### If we need animation

Keep it CSS-only on the wrapper, not inside the SVG:
```css
.login-hero__graphic {
  animation: fadeIn 0.6s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .login-hero__graphic { animation: none; }
}
```

### If we need to A/B test

Serve different SVG files via EJS conditional:
```ejs
<% if (variant === 'dark') { %>
  <img src="/images/frontier-illustration.svg" ...>
<% } else { %>
  <img src="/images/frontier-illustration-light.svg" ...>
<% } %>
```

---

## Dependencies

| Dependency | Purpose | Status |
|---|---|---|
| None | Pure SVG — no external libraries | ✅ |
| `public/images/frontier-illustration.svg` | Asset file | ✅ Created |

---

## Verification Checklist

- [ ] SVG renders correctly in Chrome, Safari, Firefox
- [ ] SVG renders at 800×480, scales to container
- [ ] Dark background visible behind SVG (no white box)
- [ ] Frosted glass cards have visible transparency
- [ ] Emerald/gold accents are legible against dark bg
- [ ] Brand wordmark is readable
- [ ] No broken image in preview (`onerror` fallback not triggered)
- [ ] File size < 50KB
- [ ] `npm run build` succeeds
- [ ] Accessible: `role="img"`, `aria-label`, `<title>`, `<desc>` all present

---

## Stories This Relates To

| Story | Relationship |
|---|---|
| [story-applicant-dashboard-auth.md](./story-applicant-dashboard-auth.md) | Login page that hosts this illustration |
| [story-applicant-dashboard-styling.md](./story-applicant-dashboard-styling.md) | Shared color palette and design tokens |
| [story-applicant-warm-welcome-dashboard.md](./story-applicant-warm-welcome-dashboard.md) | Parent story — overall dashboard vision |
