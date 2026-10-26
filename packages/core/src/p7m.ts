import { FatturaPAError } from './errors.js';

/** The input is not a CAdES/PKCS#7 envelope this library can open. */
export class P7mError extends FatturaPAError {}

/** Options of {@link extractP7mContent}. */
export interface P7mOptions {
  /** Maximum size of the envelope and of the extracted content. Default 10 MiB. */
  maxBytes?: number;
}

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_DATA = '1.2.840.113549.1.7.1';
const MAX_DEPTH = 32;
const MAX_NODES = 100_000;

interface Tlv {
  /** Tag byte (class, constructed bit and number for low tag numbers). */
  tag: number;
  constructed: boolean;
  /** Offset of the first content byte. */
  start: number;
  /** Offset after the last content byte (before the end-of-contents octets for indefinite lengths). */
  end: number;
  /** Offset after the whole element. */
  next: number;
}

class BerReader {
  #nodes = 0;

  constructor(private readonly buf: Uint8Array) {}

  read(offset: number, limit: number, depth: number): Tlv {
    if (depth > MAX_DEPTH) throw new P7mError('ASN.1 nesting too deep');
    if ((this.#nodes += 1) > MAX_NODES) throw new P7mError('ASN.1 structure too large');
    if (offset + 2 > limit) throw new P7mError('Truncated ASN.1 element');
    const tag = this.buf[offset]!;
    if ((tag & 0x1f) === 0x1f) throw new P7mError('High tag numbers are not supported');
    const constructed = (tag & 0x20) !== 0;
    let pos = offset + 1;
    const first = this.buf[pos]!;
    pos += 1;
    if (first === 0x80) {
      if (!constructed) throw new P7mError('Indefinite length on a primitive element');
      const start = pos;
      let cursor = pos;
      for (;;) {
        if (cursor + 2 > limit) throw new P7mError('Missing end-of-contents');
        if (this.buf[cursor] === 0 && this.buf[cursor + 1] === 0) {
          return { tag, constructed, start, end: cursor, next: cursor + 2 };
        }
        cursor = this.read(cursor, limit, depth + 1).next;
      }
    }
    let length: number;
    if (first < 0x80) {
      length = first;
    } else {
      const count = first & 0x7f;
      if (count > 4) throw new P7mError('ASN.1 length too large');
      length = 0;
      for (let i = 0; i < count; i += 1) {
        if (pos >= limit) throw new P7mError('Truncated ASN.1 length');
        length = length * 256 + this.buf[pos]!;
        pos += 1;
      }
    }
    const end = pos + length;
    if (end > limit) throw new P7mError('ASN.1 element exceeds its container');
    return { tag, constructed, start: pos, end, next: end };
  }

  childrenOf(node: Tlv, depth: number): Tlv[] {
    if (!node.constructed) throw new P7mError('Expected a constructed element');
    const out: Tlv[] = [];
    let cursor = node.start;
    while (cursor < node.end) {
      const child = this.read(cursor, node.end, depth + 1);
      out.push(child);
      cursor = child.next;
    }
    return out;
  }

  oid(node: Tlv): string {
    if (node.tag !== 0x06 || node.end <= node.start) throw new P7mError('Expected an OBJECT IDENTIFIER');
    const bytes = this.buf.subarray(node.start, node.end);
    const parts: number[] = [];
    let value = 0;
    for (const b of bytes) {
      value = value * 128 + (b & 0x7f);
      if (value > Number.MAX_SAFE_INTEGER / 128) throw new P7mError('OID component too large');
      if ((b & 0x80) === 0) {
        if (parts.length === 0)
          parts.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
        else parts.push(value);
        value = 0;
      }
    }
    return parts.join('.');
  }

  /** Content of an OCTET STRING, concatenating the chunks of a constructed (BER) one. */
  octets(node: Tlv, depth: number, maxBytes: number): Uint8Array {
    if (node.tag === 0x04) return this.buf.subarray(node.start, node.end);
    if (node.tag !== 0x24) throw new P7mError('Expected an OCTET STRING');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (const child of this.childrenOf(node, depth)) {
      const chunk = this.octets(child, depth + 1, maxBytes);
      total += chunk.byteLength;
      if (total > maxBytes) throw new P7mError(`Signed content exceeds ${maxBytes} bytes`);
      chunks.push(chunk);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

function toDer(input: Uint8Array, maxBytes: number): Uint8Array {
  if (input[0] === 0x30) return input;
  // Some systems deliver the envelope base64-encoded, with or without PEM armour.
  const text = Buffer.from(input).toString('latin1');
  const body = text.replace(/-----(BEGIN|END) [A-Z0-9 ]+-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new P7mError('Not a DER or base64 PKCS#7 envelope');
  const der = new Uint8Array(Buffer.from(body, 'base64'));
  if (der.byteLength > maxBytes) throw new P7mError(`Envelope exceeds ${maxBytes} bytes`);
  if (der[0] !== 0x30) throw new P7mError('Not a PKCS#7 envelope');
  return der;
}

/**
 * Extracts the signed content (the invoice XML) from a CAdES-BES `.p7m` envelope (CMS SignedData with
 * encapsulated content), as delivered by the SDI for signed invoices. DER, BER (indefinite lengths,
 * chunked OCTET STRINGs) and base64-encoded envelopes are accepted.
 *
 * SECURITY: the signature is NOT verified. The SDI verified it on reception (codes 00100-00107), so content
 * that reached you through the SDI and an authenticated provider channel can be trusted to that extent;
 * if you need to prove the signature yourself, use a qualified verification service. The parser is
 * bounded (size, depth and node count) and never recurses on attacker-chosen lengths beyond the input.
 *
 * @throws {P7mError} if the input is not a SignedData envelope with encapsulated content.
 */
export function extractP7mContent(input: Uint8Array, options: P7mOptions = {}): Uint8Array {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  if (!(input instanceof Uint8Array) || input.byteLength === 0) throw new P7mError('Empty input');
  if (input.byteLength > maxBytes * 2) throw new P7mError(`Envelope exceeds ${maxBytes} bytes`);
  const der = toDer(input, maxBytes);
  const r = new BerReader(der);

  const contentInfo = r.read(0, der.byteLength, 0);
  if (contentInfo.tag !== 0x30) throw new P7mError('ContentInfo must be a SEQUENCE');
  const [typeNode, explicit] = r.childrenOf(contentInfo, 0);
  if (!typeNode || !explicit || r.oid(typeNode) !== OID_SIGNED_DATA)
    throw new P7mError('Not a CMS SignedData envelope');
  if (explicit.tag !== 0xa0) throw new P7mError('Missing SignedData');
  const [signedData] = r.childrenOf(explicit, 1);
  if (!signedData || signedData.tag !== 0x30) throw new P7mError('SignedData must be a SEQUENCE');
  const fields = r.childrenOf(signedData, 2);
  // version INTEGER, digestAlgorithms SET, encapContentInfo SEQUENCE, …
  const encap = fields[2];
  if (fields[0]?.tag !== 0x02 || fields[1]?.tag !== 0x31 || !encap || encap.tag !== 0x30) {
    throw new P7mError('Malformed SignedData');
  }
  const [eType, eExplicit] = r.childrenOf(encap, 3);
  if (!eType || r.oid(eType) !== OID_DATA) throw new P7mError('Encapsulated content is not id-data');
  if (!eExplicit || eExplicit.tag !== 0xa0)
    throw new P7mError('Detached signature: the envelope has no content');
  const [octetString] = r.childrenOf(eExplicit, 4);
  if (!octetString) throw new P7mError('Empty encapsulated content');
  const content = r.octets(octetString, 5, maxBytes);
  if (content.byteLength > maxBytes) throw new P7mError(`Signed content exceeds ${maxBytes} bytes`);
  return new Uint8Array(content);
}

/** True if the bytes look like a PKCS#7 envelope (DER SEQUENCE or base64 of one) rather than XML. */
export function looksLikeP7m(input: Uint8Array): boolean {
  if (input[0] === 0x30) return true;
  const head = Buffer.from(input.subarray(0, 64)).toString('latin1').trimStart();
  return head.startsWith('MI') || head.startsWith('-----BEGIN PKCS7') || head.startsWith('-----BEGIN CMS');
}
