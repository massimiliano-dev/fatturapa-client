/**
 * Downloads the official FatturaPA and SDI schemas into `vendor/fatturapa-schemas` (gitignored) and
 * verifies each against its pinned SHA-256 (packages/validator/src/pins.ts). A file whose hash differs is
 * never written: a changed official schema needs a deliberate review and a new pin.
 *
 *   pnpm sync:schemas [targetDir]
 *
 * Runs directly with Node.js >= 22.18 (type stripping); only `node:` built-ins and global fetch.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PINNED_SCHEMAS } from '../src/pins.ts';

const MAX_BYTES = 2 * 1024 * 1024;

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).host}`);
  const final = new URL(response.url);
  if (final.protocol !== 'https:') throw new Error(`Refusing non-HTTPS redirect for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error(`${url} exceeds ${MAX_BYTES} bytes`);
  return bytes;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const target = resolve(process.argv[2] ?? join(repoRoot, 'vendor', 'fatturapa-schemas'));
  await mkdir(target, { recursive: true });
  let failures = 0;
  for (const pin of PINNED_SCHEMAS) {
    const path = join(target, pin.fileName);
    const existing = await readFile(path).catch(() => undefined);
    if (existing && createHash('sha256').update(existing).digest('hex') === pin.sha256) {
      console.log(`ok       ${pin.fileName}`);
      continue;
    }
    try {
      const bytes = await download(pin.url);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== pin.sha256) {
        failures += 1;
        console.error(`MISMATCH ${pin.fileName}: got ${hash}, pinned ${pin.sha256}. Not written.`);
        continue;
      }
      const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
      await writeFile(tmp, bytes, { mode: 0o644 });
      await rename(tmp, path);
      console.log(`fetched  ${pin.fileName}`);
    } catch (error) {
      failures += 1;
      console.error(`FAILED   ${pin.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`Schemas ready in ${target}`);
}

main().catch((error: unknown) => {
  console.error(`sync-schemas failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
