## What and why

## Checklist

- [ ] Tests added or updated (`pnpm test`)
- [ ] A changeset if a published package changes (`pnpm changeset`)
- [ ] `pnpm check:secrets` passes: no API tokens, keys, JWTs, `.env` files, IBANs or fiscal codes in the diff
- [ ] Only synthetic data in fixtures, tests and examples (no real companies or people, not even anonymised)
- [ ] New error messages and logs go through `redact()` and never include tokens or invoice content
- [ ] Facts about SDI or a provider API cite the official source, or are marked `TODO(verify)`
