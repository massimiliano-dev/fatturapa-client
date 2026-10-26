/**
 * SYNTHETIC identifiers. The VAT numbers are sequences chosen only because their check digit is valid
 * (0123456789-7 and 0987654321-7): they are not meant to identify anyone. Natural-person fiscal codes are
 * generated at run time from obviously fake names, so that no fiscal code appears in the repository.
 */
export const SELLER_VAT = '01234567897';
export const BUYER_VAT = '09876543217';
export const TRANSMITTER_VAT = SELLER_VAT;

const ODD: Record<string, number> = {
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

/** Appends the check character to a 15-character fiscal code prefix. */
export function withCheckCharacter(prefix15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    const ch = prefix15[i]!;
    const code = ch.charCodeAt(0);
    sum += i % 2 === 0 ? ODD[ch]! : code <= 57 ? code - 48 : code - 65;
  }
  return prefix15 + String.fromCharCode(65 + (sum % 26));
}

/** A synthetic natural-person fiscal code ("PROVA TEST", 1 January 1980, Rome). */
export function syntheticCodiceFiscale(): string {
  return withCheckCharacter(['PRV', 'TST', '80A01', 'H501'].join(''));
}

/** A syntactically valid synthetic IBAN, built at run time (not a real account). */
export function syntheticIban(): string {
  return ['IT', '60', 'X', '05428', '11101', '000000123456'].join('');
}
