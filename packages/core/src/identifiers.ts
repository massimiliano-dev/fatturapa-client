/**
 * Checks of Italian fiscal identifiers. These are local syntax and check-digit checks only: the SDI also
 * verifies that the identifier exists in the Anagrafe Tributaria (rejection codes 00300-00306), which
 * cannot be done offline.
 */

/**
 * Partita IVA: 11 digits, the last one a Luhn-style check digit (D.M. 23/12/1976). Also the format of the
 * numeric codice fiscale of companies and other non-natural persons.
 */
export function isValidPartitaIva(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    let digit = value.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === value.charCodeAt(10) - 48;
}

const ODD_VALUES: Record<string, number> = {
  '0': 1,
  '1': 0,
  '2': 5,
  '3': 7,
  '4': 9,
  '5': 13,
  '6': 15,
  '7': 17,
  '8': 19,
  '9': 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};

function evenValue(ch: string): number {
  const code = ch.charCodeAt(0);
  return code <= 57 ? code - 48 : code - 65;
}

const OMO = '[0-9LMNPQRSTUV]';
const CF_PERSON = new RegExp(`^[A-Z]{6}${OMO}{2}[ABCDEHLMPRST]${OMO}{2}[A-Z]${OMO}{3}[A-Z]$`);

/**
 * Codice fiscale: either 16 characters for natural persons (with "omocodia" and check character, D.M.
 * 12/03/1974) or 11 digits for other subjects (same algorithm as the partita IVA). Upper case only, as the
 * FatturaPA XSD requires.
 */
export function isValidCodiceFiscale(value: string): boolean {
  if (/^\d{11}$/.test(value)) return isValidPartitaIva(value);
  if (!CF_PERSON.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    const ch = value[i]!;
    // Positions are 1-based in the algorithm: odd positions are even indexes.
    sum += i % 2 === 0 ? ODD_VALUES[ch]! : evenValue(ch);
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15];
}
