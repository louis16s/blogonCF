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

## If a token was exposed

Revoke or rotate it immediately at the provider. Removing it from the latest
commit is not sufficient because Git history, build logs and forks may retain
the value.
