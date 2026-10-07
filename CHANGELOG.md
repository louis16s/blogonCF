# Changelog

All notable changes to blogonCF are documented here. Versions follow Semantic Versioning.

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
