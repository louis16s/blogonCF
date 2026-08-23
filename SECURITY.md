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

- Password-protected bodies, child pages and Notion-hosted images require the
  article-scoped HttpOnly unlock session.
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
