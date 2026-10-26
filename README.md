# fatturapa-client

TypeScript toolkit for Italian electronic invoicing (**FatturaPA** and the **SDI**, Sistema di Interscambio):
build and parse invoice XML, check it locally against the official XSD and the SDI rejection rules, read
SDI notifications and signed `.p7m` files, and send invoices through SDI intermediaries
(**Openapi.it**, **Fatture in Cloud**) behind one `SdiProvider` interface. Includes a NestJS module and a
`fatturapa` CLI.

> [!WARNING]
> **Unofficial project.** Not affiliated with, endorsed by or supported by the Agenzia delle Entrate,
> Sogei, Openapi S.p.A. or TeamSystem (Fatture in Cloud). The official technical specifications are the only
> authority; the SDI is the final judge of every invoice. Using this software does not make you an
> accredited channel.

> [!CAUTION]
> Invoices contain **personal data** (names and fiscal codes of sole traders and consumers, addresses,
> IBANs) and provider tokens let anyone **issue invoices in your name**. Develop with the providers'
> sandboxes and synthetic data only; never put real invoices, VAT numbers, fiscal codes, IBANs or tokens in
> issues, logs or test fixtures. See [SECURITY.md](SECURITY.md).

## Reference versions

| What                                  | Version                                                   | Source                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical specifications (Allegato A) | **1.9.1**, usable from 15 May 2026                        | [agenziaentrate.gov.it](https://www.agenziaentrate.gov.it/portale/specifiche-tecniche-versione-1.9.1-%C2%A0-utilizzabili-dal-15-maggio-2026-)            |
| Ordinary invoice schema (FPR12/FPA12) | **1.2.3** (`Schema_VFPR12_v1.2.3.xsd`, SHA-256 pinned)    | [fatturapa.gov.it](https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/)                                 |
| SDI notifications                     | `MessaggiTypes_v1.1.xsd`, `MessaggiFatturaTypes_v1.0.xsd` | fatturapa.gov.it, agenziaentrate.gov.it                                                                                                                  |
| Openapi.it SDI API                    | OpenAPI "SDI 1.0.0"                                       | [console.openapi.com](https://console.openapi.com/apis/sdi/documentation)                                                                                |
| Fatture in Cloud API                  | v2, OpenAPI 2.1.8 (commit `362e3fe`)                      | [developers.fattureincloud.it](https://developers.fattureincloud.it), [openapi-fattureincloud](https://github.com/fattureincloud/openapi-fattureincloud) |

Code tables (TipoDocumento TD01–TD29, RegimeFiscale RF01–RF20, Natura, ModalitaPagamento MP01–MP23, …) are
generated from the XSD, and a test checks them against the pinned schema. The 65 SDI rejection codes and
their descriptions come from Allegato A 1.9.1, Appendice 1.

## Status

Early release (0.x). ✅ implemented and tested · 🟡 implemented, not yet verified against the real service · ⛔ not available

| Feature                                                                                                 | Package                        | Status                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| Typed model of the ordinary invoice (1:1 with the XSD names)                                            | `core`                         | ✅                                                     |
| XML builder: schema order, XSD facets checked, exact decimals                                           | `core`                         | ✅ output valid against the official XSD (CI)          |
| XML parser (FPR12/FPA12, batches, attachments)                                                          | `core`                         | ✅                                                     |
| `computeTotals`: line totals, VAT summaries, document total                                             | `core`                         | ✅                                                     |
| `checkBusinessRules`: 32 SDI content controls (00400–00476, 00313, …)                                   | `core`                         | ✅                                                     |
| Partita IVA / codice fiscale check digits, SDI file names                                               | `core`                         | ✅                                                     |
| SDI notifications RC NS MC NE DT AT MT EC SE (PA and B2B namespaces)                                    | `core`                         | ✅ signature not verified                              |
| `.p7m` (CAdES) content extraction, DER/BER/base64                                                       | `core`                         | ✅ signature not verified                              |
| Local XSD validation (libxml2 WebAssembly, pinned official schemas)                                     | `validator`                    | ✅                                                     |
| Simplified invoice (FSM10)                                                                              | –                              | ⛔ refused by the parser                               |
| Local XAdES/CAdES signing                                                                               | –                              | ⛔ use the provider's signature service                |
| Openapi.it: send XML (± signature, ± legal storage), status, notifications, download, callbacks, tokens | `openapi-it`                   | ✅ mocks · 🟡 sandbox smoke test ready, not yet run    |
| Fatture in Cloud: OAuth2, model mapping, send, status, rejection reason, XML                            | `fattureincloud`               | ✅ mocks · 🟡 not yet against the real API             |
| Fatture in Cloud webhooks: ES256 JWT verification, CloudEvents, subscriptions                           | `fattureincloud`               | ✅                                                     |
| Received invoices                                                                                       | `openapi-it`, `fattureincloud` | ✅ list/download (Openapi.it), list (Fatture in Cloud) |
| NestJS module                                                                                           | `nestjs`                       | ✅                                                     |
| `fatturapa` CLI: validate, inspect, notification, filename, send, status                                | `cli`                          | ✅                                                     |
| Other intermediaries (Invoicetronic, A-Cube, …)                                                         | –                              | ⛔ see [roadmap](#other-providers)                     |

## Packages

| npm                                          | What                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `@massimiliano-dev/fatturapa-core`           | model, builder, parser, totals, SDI rules, notifications, p7m, `SdiProvider`, redaction |
| `@massimiliano-dev/fatturapa-validator`      | `createFatturaPAValidator()` (XSD + rules), pinned official schemas                     |
| `@massimiliano-dev/fatturapa-openapi-it`     | `OpenapiItProvider`, `createOpenapiItToken()`, `verifyOpenapiItCallback()`              |
| `@massimiliano-dev/fatturapa-fattureincloud` | `FattureInCloudProvider`, OAuth2 helpers, `verifyFicWebhook()`                          |
| `@massimiliano-dev/fatturapa-nestjs`         | `FatturaPAModule.forRootAsync()`                                                        |
| `@massimiliano-dev/fatturapa-cli`            | the `fatturapa` command                                                                 |

ESM only, Node.js ≥ 22.19. No native modules.

## Build an invoice

```ts
import {
  buildFatturaXml,
  checkBusinessRules,
  computeTotals,
  type FatturaElettronica,
} from '@massimiliano-dev/fatturapa-core';

const draft: FatturaElettronica = {
  versione: 'FPR12',
  FatturaElettronicaHeader: {
    DatiTrasmissione: {
      IdTrasmittente: { IdPaese: 'IT', IdCodice: '01234567897' },
      ProgressivoInvio: '00001',
      CodiceDestinatario: '0000000',
    },
    CedentePrestatore: {
      DatiAnagrafici: {
        IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '01234567897' },
        Anagrafica: { Denominazione: 'Fornitore S.r.l.' },
        RegimeFiscale: 'RF01',
      },
      Sede: { Indirizzo: 'Via Roma 1', CAP: '00100', Comune: 'Roma', Provincia: 'RM', Nazione: 'IT' },
    },
    CessionarioCommittente: {
      DatiAnagrafici: {
        IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '09876543217' },
        Anagrafica: { Denominazione: 'Cliente S.p.A.' },
      },
      Sede: { Indirizzo: 'Piazza Duomo 1', CAP: '20100', Comune: 'Milano', Provincia: 'MI', Nazione: 'IT' },
    },
  },
  FatturaElettronicaBody: [
    {
      DatiGenerali: {
        DatiGeneraliDocumento: { TipoDocumento: 'TD01', Divisa: 'EUR', Data: '2026-05-20', Numero: '1/2026' },
      },
      DatiBeniServizi: {
        DettaglioLinee: [
          { Descrizione: 'Consulenza', Quantita: '10', PrezzoUnitario: '50', AliquotaIVA: '22' },
        ],
      },
    },
  ],
};

const invoice = computeTotals(draft); // PrezzoTotale, DatiRiepilogo, ImportoTotaleDocumento
const issues = checkBusinessRules(invoice); // [{ code: '00421', path: '…Imposta', message: … }] or []
const xml = buildFatturaXml(invoice); // throws FatturaPAModelError naming the element on bad input
```

Amounts accept strings, numbers or `Decimal`; arithmetic is exact (no floating point), and rounding follows
the specification ("per eccesso se uguale o superiore a 5"). Text outside the character set allowed by the
XSD (curly quotes, `€`, emoji) is refused with the element path, or replaced with
`buildFatturaXml(invoice, { text: 'transliterate' })`.

## Validate with the official schemas

```sh
pnpm sync:schemas      # downloads the XSD files into vendor/ and checks their pinned SHA-256
```

```ts
import { createFatturaPAValidator } from '@massimiliano-dev/fatturapa-validator';

const validator = await createFatturaPAValidator('vendor/fatturapa-schemas');
const { valid, issues } = await validator.validate(xml); // XSD first, then the SDI content rules
```

The rules cover what can be checked offline. The SDI also checks things only it can know: that VAT
numbers and recipient codes exist, duplicates (00404), VAT groups, letters of intent (00477), signatures.

## Send through an intermediary

All providers implement `SdiProvider` (`send`, `getStatus`, `close`) and map their statuses to one
`SdiStatus`: `draft`, `queued`, `sent`, `rejected` (NS), `delivered` (RC), `not-delivered` (MC/AT),
`accepted`/`refused` (PA outcome NE), `deadline-expired` (DT), `error`, `unknown`.

### Openapi.it (raw XML)

```ts
import { OpenapiItProvider } from '@massimiliano-dev/fatturapa-openapi-it';

const sdi = new OpenapiItProvider({ environment: 'sandbox', token: () => secrets.get('openapi-it-token') });
const { id } = await sdi.send({ xml }); // or { invoice }; options { signature, legalStorage }
const status = await sdi.getStatus(id); // { status: 'delivered', sdiIdentifier, … }
const notifications = await sdi.listNotifications(id);
```

Create a scoped, expiring token with `createOpenapiItToken({ environment, email, apiKey, ttlSeconds })` from a
trusted backend. Callbacks carry a static secret: verify it with `verifyOpenapiItCallback()` and then re-read
the invoice with `getInvoice()` before acting.

### Fatture in Cloud (model mapping)

Fatture in Cloud generates the XML itself, so it takes the typed model. The mapping covers TD01/TD04 invoices
with lines, VAT types, one percentage discount per line, payments and one order/contract/agreement
reference; anything it cannot express (withholding tax, pension funds, stamp duty, batches, …) is refused
with a `FicMappingError` instead of being dropped.

```ts
import {
  FattureInCloudProvider,
  buildFicAuthorizationUrl,
  createOAuthState,
  exchangeFicAuthorizationCode,
} from '@massimiliano-dev/fatturapa-fattureincloud';

const fic = new FattureInCloudProvider({ companyId: 12345, accessToken: () => tokens.current() });
const { id } = await fic.send({ invoice }); // create → XML check → send; { dryRun: true } stops before sending
```

Webhooks are signed: `verifyFicWebhook(request, { audience: 'https://your.app/fic-webhook' })` checks the
ES256 JWT (published key), issuer, audience, expiry and binds it to the event id; `handleFicVerification()`
answers the subscription challenge. Fatture in Cloud has **no sandbox**: test on a dedicated test company.

## SDI notifications and signed files

```ts
import {
  extractP7mContent,
  parseFatturaXml,
  parseSdiNotification,
  statusFromNotification,
} from '@massimiliano-dev/fatturapa-core';

const n = parseSdiNotification(xml); // { type: 'NS', ListaErrori: [{ Codice: '00423', officialDescription: … }] }
statusFromNotification(n.type, n.Esito); // 'rejected'
const invoice = parseFatturaXml(extractP7mContent(p7mBytes)); // received signed invoice (signature not verified)
```

## CLI

```sh
fatturapa validate invoice.xml                    # XSD + SDI rules, exit code 1 if invalid
fatturapa inspect IT01234567897_00001.xml.p7m     # summary with masked identifiers
fatturapa notification IT01234567897_00001_NS_001.xml
fatturapa filename --id IT01234567897 --progressive 42
OPENAPI_IT_TOKEN=… fatturapa send invoice.xml --provider openapi-it --env sandbox
```

Tokens are read only from environment variables (`OPENAPI_IT_TOKEN`, `FIC_ACCESS_TOKEN`), never from flags.
Production requires `--confirm-production`.

## Other providers

Researched on 2026-10-26 for the next adapters, ranked by how well they can be integrated and tested
(public docs, sandbox, raw XML, signed webhooks). Not implemented yet.

| Provider                                                                                          | Why                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Invoicetronic](https://invoicetronic.com/en/docs/)                                               | MIT OpenAPI spec, free self-service sandbox with an SDI simulator, raw XML, HMAC-SHA256 webhooks        |
| [A-Cube](https://docs.acubeapi.com/documentation/italy)                                           | OpenAPI spec, sandbox, raw XML or JSON, Ed25519-signed webhooks (HTTP Message Signatures), preservation |
| [Fattura Elettronica API](https://www.fattura-elettronica-api.it/documentazione2.0/)              | public pricing, test endpoint, raw XML; webhooks only with a static bearer token                        |
| [Aruba Fatturazione Elettronica](https://fatturazioneelettronica.aruba.it/apidoc/v2/docs_EN.html) | large user base; no OpenAPI, short-lived tokens, strict rate limits, callbacks for Premium only         |

Not integrable as providers: the Agenzia delle Entrate "Fatture e Corrispettivi" portal (no API; a direct
SdICoop/SFTP channel needs accreditation), and invoicing apps without a public SDI API (Danea Easyfatt,
Qonto, Namirial e-invoicing). Adding a provider means implementing `SdiProvider` in a new package: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```sh
pnpm install
pnpm test            # unit tests (no network)
pnpm sync:schemas && pnpm test   # also runs the official-XSD tests
pnpm lint && pnpm typecheck && pnpm check:secrets
```

## License

MIT. The official schemas are not redistributed: `pnpm sync:schemas` downloads them from the publishers.
