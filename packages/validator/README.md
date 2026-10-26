# @massimiliano-dev/fatturapa-validator

Local validation of FatturaPA XML against the official XSD (libxml2 as WebAssembly, offline) followed by the
SDI content rules. Schemas are downloaded with `pnpm sync:schemas` and verified by SHA-256 on every load.

```ts
const validator = await createFatturaPAValidator('vendor/fatturapa-schemas');
const { valid, issues } = await validator.validate(xml);
```
