import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FatturaPAError } from '@massimiliano-dev/fatturapa-core';
import { PINNED_SCHEMAS } from './pins.js';
import type { XmlFile } from './xmllint.js';

/** A set of XSD files: the entry schema plus everything it imports. */
export interface XsdSchemaSet {
  entry: XmlFile;
  includes: readonly XmlFile[];
}

/** Which official schema to validate against. */
export type FatturaPASchemaKind = 'fattura' | 'messaggi-pa' | 'messaggi-b2b';

const ENTRY: Record<FatturaPASchemaKind, string> = {
  fattura: 'Schema_VFPR12_v1.2.3.xsd',
  'messaggi-pa': 'MessaggiTypes_v1.1.xsd',
  'messaggi-b2b': 'MessaggiFatturaTypes_v1.0.xsd',
};

const XMLDSIG = 'xmldsig-core-schema.xsd';
const XMLDSIG_REMOTE = 'http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd';

/** A schema file is missing or does not match its pinned SHA-256. */
export class SchemaIntegrityError extends FatturaPAError {}

async function readPinned(dir: string, fileName: string): Promise<string> {
  const pin = PINNED_SCHEMAS.find((p) => p.fileName === fileName);
  if (!pin) throw new SchemaIntegrityError(`${fileName} is not a pinned schema`);
  let bytes: Buffer;
  try {
    bytes = await readFile(join(dir, fileName));
  } catch {
    throw new SchemaIntegrityError(`${fileName} not found in the schemas folder: run "pnpm sync:schemas"`);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== pin.sha256) throw new SchemaIntegrityError(`${fileName} does not match its pinned SHA-256`);
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

/**
 * Loads an official schema from a folder written by `pnpm sync:schemas`, verifying every file against its
 * pinned SHA-256. Two deterministic adjustments are made in memory so that libxml2 can run offline:
 * - absolute `schemaLocation`s of the XML Signature schema are pointed at the local copy;
 * - the DOCTYPE of the W3C XML Signature schema is removed (its internal subset only declares the
 *   XMLSchema DTD and an entity the schema never uses), so that no DTD is ever processed.
 *
 * @throws {SchemaIntegrityError} if a file is missing or altered.
 */
export async function loadFatturaPASchema(
  dir: string,
  kind: FatturaPASchemaKind = 'fattura',
): Promise<XsdSchemaSet> {
  const entryName = ENTRY[kind];
  const entry = (await readPinned(dir, entryName)).split(XMLDSIG_REMOTE).join(XMLDSIG);
  const xmldsig = (await readPinned(dir, XMLDSIG)).replace(/<!DOCTYPE[\s\S]*?\]>/, '');
  if (/<!DOCTYPE|<!ENTITY|&\w+;/.test(xmldsig.replace(/&(amp|lt|gt|quot|apos);/g, ''))) {
    throw new SchemaIntegrityError('Unexpected DTD content in the XML Signature schema');
  }
  return {
    entry: { fileName: entryName, contents: entry },
    includes: [{ fileName: XMLDSIG, contents: xmldsig }],
  };
}
