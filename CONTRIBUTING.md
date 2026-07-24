# Contributing

Thanks for helping improve bloginCF.

## Development

1. Fork the repository and create a focused branch.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to `.env` and use a test Notion database.
4. Make the smallest complete change.
5. Run `pnpm test` and `pnpm lint`.
6. Open a pull request describing behavior changes and security implications.

Never use a production token in fixtures, screenshots, logs or commits. Tests
should mock Notion and D1 requests. New Notion block types should include
rendering and malformed-input coverage. Password-related changes must prove
that protected blocks are not fetched or returned before successful unlock.
