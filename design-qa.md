# Design QA

## Target and evidence

- User reference: `/var/folders/nt/07g699y55x3cx5cpj33ng3000000gn/T/TemporaryItems/NSIRD_screencaptureui_ZL1Otk/截屏2026-08-01 00.56.09.png`
- Live article sidebar: `/tmp/louis16s-sidebar-qa/article-sidebar-dark-v2.png`
- Live homepage sidebar: `/tmp/louis16s-sidebar-qa/home-sidebar-dark-v2.png`
- Combined comparison: `/tmp/louis16s-sidebar-qa/sidebar-comparison.png`
- Browser: Chromium fallback previously approved by the user; the in-app browser was unavailable.
- State: production, dark theme, 1000 × 720 CSS viewport at 2× pixel density.

## Visual review

- The avatar, `louis16s` wordmark, sidebar inset, radius, border, and dark palette remain aligned with the supplied screenshot.
- The new home entry is visually attached to the identity area through shared spacing and a restrained copper accent, rather than appearing as a detached generic button.
- `HOME` provides a quiet orientation cue; the house icon and animated diagonal arrow make the destination understandable without an ambiguous glyph-only action.
- Word cloud, tools, and categories now share one low-contrast `浏览` panel with common padding, separators, and disclosure behavior.
- Tool and category count pills were removed to reduce noise. Existing Notion emoji and external-link indicators remain.
- The old article-end `返回全部文章` text is absent.

## Interaction and responsive checks

- The home entry appears on article and Page routes and is absent on the homepage.
- The entire home card is keyboard-focusable and links to `/`.
- Mobile keeps a text-labeled `返回主页` destination inside the top-level menu.
- Tool and category disclosures remain keyboard-operable and keep their persisted open/closed behavior.
- Production Chromium reported no console or page errors.
- Lint, production build, and all 52 tests passed.

## Findings

No actionable P0/P1/P2 findings remain. The supplied screenshot ends before the new control area, so the new home entry intentionally extends the existing visual language instead of reproducing a missing reference element.

final result: passed
