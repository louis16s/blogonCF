# Changelog

All notable changes to blogonCF are documented here. Versions follow Semantic Versioning.

## [1.1.4] - 2026-10-23

### Fixed

- Search and word-cloud feature switches now stop content reads before metadata or corpus work starts.
- Upstream configuration and metadata failures return structured, uncached API errors instead of escaping the request handler.
- Homepage memory-cache hits skip configuration resolution; memory and edge snapshots include the configured content source in their keys.
- Excluded transient Playwright output from lint traversal to prevent cleanup races.

### Security

- Upgraded Next.js and its ESLint configuration to 16.4.1, Vite to 8.2.4, and KaTeX to 0.18.2 for published security fixes.

### Verification

- Added runtime regressions for disabled features, metadata failures, and homepage cache isolation across content sources.

## [1.1.3] - 2026-10-17

### Improved

- Added shared per-IP limits to public media, child-page, and database reads before they can fan out to Notion.
- Made long-directory failures resumable from the sidebar without forcing a page reload.
- Let the homepage edge cache return before reading Notion configuration, and added a 15-second metadata-only snapshot for search and word-cloud visibility filtering.

### Verification

- Added regression coverage for read limits, metadata-only cache reuse, and homepage edge hits across Worker isolates.

## [1.1.2] - 2026-10-13

### Fixed

- Unified password protection for Post and Page bodies, children, databases, media, and SSR. Unlock sessions now bind the canonical page ID and current password.
- Revalidated publication/password metadata before returning public content snapshots. Search and word cloud filter stale indexes against current public metadata; readers receive no-store responses.
- Stopped automatic continuation requests after a failure and added explicit retry controls. Removed duplicate HTML preloads while retaining the article-opening animation.
- Recovered failed empty search-index entries during incremental and full synchronization.
- Added child-database pagination and on-site entry navigation, published Notion cross-links, inline equations, and safe YouTube/Vimeo players with source links.
- Separated long-article heading indexing from the first body response, bounded each directory batch, and retained progress when D1 checkpoint storage is unavailable.
- Updated vulnerable dependencies. A narrowly scoped, expiring exception remains for the unpatched build-time braces advisory.

### Verification

- Added runtime regression tests for protected Pages, credential rotation, cache revocation, index recovery, continuation failures, database pagination, formulas, videos, and navigation restoration.

## [1.1.1] - 2026-10-07

### Improved

- Disabled separately metered Workers Caching and explicitly retained free asset-first routing and the application Cache API.
- Public search and article chunks now reuse browser HTTP caching; private articles avoid speculative document preloads.
- Public API cache keys ignore tracking parameters; expired rate-limit rows are cleaned daily instead of every 15 minutes.

### Security

- Added shared D1 limits for expensive cache-miss APIs, HTTPS redirects, HSTS, and secure production unlock cookies.
- Private content, sessions, and protected media remain excluded from shared caches.

## [1.1.0] - 2026-09-30

### Added

- Incremental Notion content-index refresh every 15 minutes and external RSS refresh every hour.
- A dedicated content-index synchronization module that separates D1 cursor and reconciliation logic from Worker request routing.
- A single Cron Trigger schedules all maintenance jobs to fit Cloudflare Free account limits.
- Release notes and documented semantic-versioning, deployment, and rollback practices.

### Improved

- Daily reconciliation remains responsible for removing deleted, archived, and unpublished posts from the public search index.
- Long home-page article lists defer off-screen card rendering while preserving their layout and existing opening transitions.
- README performance and content freshness guarantees now match the configured schedules.
