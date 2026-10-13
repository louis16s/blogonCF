# Security Policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when it
is available. Otherwise contact the repository owner privately. Do not open a
public Issue containing:

- Notion, Cloudflare or GitHub tokens
- passwords or password-protected article content
- unpublished Notion page IDs
- a working exploit against a production site

Include the affected route, reproduction steps, expected impact and a minimal
proof of concept. You should receive an acknowledgement within seven days.

## Runtime boundaries

- Password-protected Post and Page bodies, child pages, databases and Notion-hosted
  media require a root-page-scoped HttpOnly unlock session. Sessions bind the
  canonical page ID and current password; changing that password revokes them.
- Public body snapshots are gated by current Notion publication/password metadata.
  Search and word cloud filter durable indexes against the current public-page list.
  Reader-facing content responses use no-store. Previously downloaded content cannot
  be remotely erased; metadata requests fail closed when Notion is unavailable.
- Public Notion image URLs are signed by the Worker and contain block IDs, not
  expiring upstream file URLs. The Worker re-resolves the current file URL and
  only accepts the configured Notion file host.
- RSS and link-preview fetches reject credentials, local hostnames and private
  IP literals, follow only validated redirects, and enforce response limits.
- Public configuration is an explicit allowlist; integration tokens must stay
  in Cloudflare Secrets.

## If a token was exposed

Revoke or rotate it immediately at the provider. Removing it from the latest
commit is not sufficient because Git history, build logs and forks may retain
the value.
