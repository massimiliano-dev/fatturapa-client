# Contributing

Thanks for helping. Issues and pull requests are welcome.

1. `pnpm install`, then `pnpm test`. For the official-schema tests run `pnpm sync:schemas` first (downloads the
   pinned XSD files into the gitignored `vendor/`).
2. **Synthetic data only.** Never commit or paste real invoices, VAT numbers, fiscal codes, IBANs, names,
   tokens or keys, not even anonymised. Use `fixtures/`; build fiscal codes and IBANs at run time like
   `syntheticCodiceFiscale()` so that the secrets scan stays clean.
3. `pnpm check:secrets` must pass. A line may opt out with `check-secrets: allow` only for documented,
   obviously fake values.
4. Facts about the SDI or a provider (endpoints, codes, statuses, limits) must cite the official source in
   TSDoc; if they cannot be confirmed, mark them `TODO(verify)`.
5. Errors and output go through `redact()`. Security-relevant behaviour needs a test that shows the
   protection (see the XXE, redirect, webhook forgery and redaction tests).
6. Add a changeset for any change to a published package: `pnpm changeset`.

Code style is enforced by ESLint and Prettier (`pnpm lint`, `pnpm format`). Public APIs need TSDoc comments.

## Adding a provider

Create `packages/<provider>` implementing `SdiProvider` from `fatturapa-core`:

- use `HttpClient` (HTTPS only, no redirects, bounded bodies, redacted errors) and bounded zod schemas;
- map the provider's statuses to `SdiStatus` in an exported, tested function, keeping the raw value in
  `providerStatus` and mapping unknown values to `unknown`;
- never retry `send`; verify webhooks with the strongest mechanism the provider offers and test forgeries;
- test with undici `MockAgent` (`agent.disableNetConnect()`), plus an optional `*.live.test.ts` against the
  provider's **sandbox** only.

## Live tests (maintainers)

`pnpm test:live` runs `*.live.test.ts` when `FATTURAPA_LIVE=sandbox` and the credentials are set:

- Openapi.it sandbox: `OPENAPI_IT_SANDBOX_TOKEN`, `OPENAPI_IT_SANDBOX_FISCAL_ID` (a business registry
  configured in the sandbox). Sends the synthetic invoice.
- Fatture in Cloud: `FIC_ACCESS_TOKEN`, `FIC_COMPANY_ID` of a dedicated test company. Read-only.

In CI they run only when the repository variable `FATTURAPA_LIVE` is `sandbox`, never for pull requests, in
the `sandbox` environment (configure required reviewers).
