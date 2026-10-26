import { extractP7mContent, looksLikeP7m } from '@massimiliano-dev/fatturapa-core';
import { readRegularFile } from './files.js';

/** Maximum input size: the SDI accepts files up to 5 MB; signed envelopes are a little larger. */
export const MAX_INPUT_BYTES = 6 * 1024 * 1024;

/** Reads an XML file, unwrapping a CAdES `.p7m` envelope (signature not verified). */
export async function readInvoiceFile(path: string): Promise<{ xml: Uint8Array; wasP7m: boolean }> {
  const { data } = await readRegularFile(path, { maxBytes: MAX_INPUT_BYTES });
  const bytes = new Uint8Array(data);
  if (/\.p7m$/i.test(path) || looksLikeP7m(bytes))
    return { xml: extractP7mContent(bytes, { maxBytes: MAX_INPUT_BYTES }), wasP7m: true };
  return { xml: bytes, wasP7m: false };
}
