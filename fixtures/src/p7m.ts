/**
 * Builds a SYNTHETIC CMS SignedData envelope around some content, with empty certificate and signer sets.
 * Good enough to test content extraction; it is not a valid signature and must never be presented as one.
 */
function len(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

function tlv(tag: number, content: Uint8Array | number[]): number[] {
  const c = Array.from(content);
  return [tag, ...len(c.length), ...c];
}

/** Indefinite-length constructed element (BER). */
function tlvIndef(tag: number, children: number[][]): number[] {
  return [tag, 0x80, ...children.flat(), 0x00, 0x00];
}

const OID_SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const OID_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];
const OID_SHA256 = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];

/** DER envelope, or BER with indefinite lengths and the content split into chunks (`chunkSize`). */
export function syntheticP7m(
  content: Uint8Array,
  options: { ber?: boolean; chunkSize?: number } = {},
): Uint8Array {
  const digestAlgs = tlv(0x31, tlv(0x30, [...tlv(0x06, OID_SHA256), 0x05, 0x00]));
  const version = tlv(0x02, [0x01]);
  const signerInfos = tlv(0x31, []);
  if (!options.ber) {
    const encap = tlv(0x30, [...tlv(0x06, OID_DATA), ...tlv(0xa0, tlv(0x04, content))]);
    const signedData = tlv(0x30, [...version, ...digestAlgs, ...encap, ...signerInfos]);
    return new Uint8Array(tlv(0x30, [...tlv(0x06, OID_SIGNED_DATA), ...tlv(0xa0, signedData)]));
  }
  const size = options.chunkSize ?? 7;
  const chunks: number[][] = [];
  for (let i = 0; i < content.length; i += size) chunks.push(tlv(0x04, content.subarray(i, i + size)));
  const encap = tlvIndef(0x30, [tlv(0x06, OID_DATA), tlvIndef(0xa0, [tlvIndef(0x24, chunks)])]);
  const signedData = tlvIndef(0x30, [version, digestAlgs, encap, signerInfos]);
  return new Uint8Array(tlvIndef(0x30, [tlv(0x06, OID_SIGNED_DATA), tlvIndef(0xa0, [signedData])]));
}
