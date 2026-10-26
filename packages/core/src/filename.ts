import { FatturaPAError } from './errors.js';

/**
 * SDI file names, Allegato A 1.9.1 §1.2.2: `<country><identifier>_<progressive>.<ext>`.
 * - country: ISO 3166-1 alpha-2;
 * - identifier: the transmitter's fiscal identifier, 11-16 characters for `IT`, 2-28 otherwise (not checked
 *   against the invoice content by the SDI);
 * - progressive: 1-5 characters `[A-Za-z0-9]`, unique per transmitter (a duplicate name is rejected
 *   with code 00002);
 * - extension: `.xml` (unsigned or XAdES), `.xml.p7m` (CAdES) or `.zip` (archive of invoices).
 */
const INVOICE_FILE_NAME = /^([A-Z]{2})([A-Za-z0-9]{2,28})_([A-Za-z0-9]{1,5})\.(xml|xml\.p7m|zip)$/;

/** Notification files, Allegato A §1.1 of the receipts section: `<invoice file name>_<type>_<nnn>.xml`. */
const NOTIFICATION_FILE_NAME =
  /^([A-Z]{2}[A-Za-z0-9]{2,28}_[A-Za-z0-9]{1,5})_(RC|NS|MC|NE|DT|AT|MT|EC|SE)_([A-Za-z0-9]{1,3})\.xml$/;

export interface SdiFileName {
  country: string;
  identifier: string;
  progressive: string;
  extension: 'xml' | 'xml.p7m' | 'zip';
}

export class InvalidFileNameError extends FatturaPAError {}

/** Parses and validates an invoice file name. Returns undefined if it does not follow the SDI rules (00001). */
export function parseSdiFileName(name: string): SdiFileName | undefined {
  const match = INVOICE_FILE_NAME.exec(name);
  if (!match) return undefined;
  const [, country, identifier, progressive, extension] = match as unknown as [
    string,
    string,
    string,
    string,
    SdiFileName['extension'],
  ];
  if (country === 'IT' && (identifier.length < 11 || identifier.length > 16)) return undefined;
  return { country, identifier, progressive, extension };
}

/**
 * Builds an invoice file name.
 *
 * @param progressive a 1-5 character alphanumeric string, or a non-negative integer encoded with
 *   {@link toProgressivo}.
 * @throws {InvalidFileNameError} if the result would not be accepted by the SDI.
 */
export function buildSdiFileName(input: {
  country: string;
  identifier: string;
  progressive: string | number;
  extension?: SdiFileName['extension'];
}): string {
  const progressive =
    typeof input.progressive === 'number' ? toProgressivo(input.progressive) : input.progressive;
  const name = `${input.country}${input.identifier}_${progressive}.${input.extension ?? 'xml'}`;
  if (!parseSdiFileName(name))
    throw new InvalidFileNameError('The resulting file name does not follow the SDI naming rules');
  return name;
}

/** Encodes a counter as a 5-character base-36 progressive (`0` → `00000`, max 36^5 − 1 = 60,466,175). */
export function toProgressivo(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 36 ** 5) {
    throw new RangeError('progressive counter must be an integer between 0 and 60466175');
  }
  return n.toString(36).toUpperCase().padStart(5, '0');
}

export interface SdiNotificationFileName {
  invoiceFileBaseName: string;
  type: 'RC' | 'NS' | 'MC' | 'NE' | 'DT' | 'AT' | 'MT' | 'EC' | 'SE';
  progressive: string;
}

/** Parses a notification file name such as `IT01234567890_11111_RC_001.xml`. */
export function parseSdiNotificationFileName(name: string): SdiNotificationFileName | undefined {
  const match = NOTIFICATION_FILE_NAME.exec(name);
  if (!match) return undefined;
  return {
    invoiceFileBaseName: match[1]!,
    type: match[2] as SdiNotificationFileName['type'],
    progressive: match[3]!,
  };
}
