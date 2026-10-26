/**
 * Exact decimal arithmetic for invoice amounts.
 *
 * Binary floating point cannot represent 0.10 or 22.00 % exactly, and the SDI checks totals to the cent
 * (rejection codes 00421, 00422, 00423). Amounts are therefore kept as a `bigint` of units plus a scale
 * (number of decimal digits). Only the operations needed by FatturaPA are provided: no general division.
 */

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** Maximum number of decimal digits kept by multiplications (FatturaPA uses at most 8). */
const MAX_SCALE = 16;

/** An exact decimal number. Immutable. */
export class Decimal {
  private constructor(
    /** Value multiplied by 10^scale. */
    readonly units: bigint,
    /** Number of decimal digits. */
    readonly scale: number,
  ) {}

  /**
   * Parses `"12.50"`, `"-3"`, `"0.00000001"`, or a finite JS number written without an exponent.
   * Numbers are accepted for convenience: `0.1` becomes exactly `0.1`, because the shortest round-trip
   * representation is used, not the binary value.
   *
   * @throws {RangeError} on anything else (exponents, NaN, Infinity, empty strings, thousands separators).
   */
  static from(value: string | number | bigint | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    if (typeof value === 'bigint') return new Decimal(value, 0);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError('Not a finite number');
      const text = String(value);
      if (/e/i.test(text)) throw new RangeError('Numbers with an exponent are not accepted; pass a string');
      return Decimal.from(text);
    }
    const match = DECIMAL.exec(value.trim());
    if (!match) throw new RangeError('Not a decimal number');
    const [, sign, int, frac = ''] = match;
    if (frac.length > MAX_SCALE) throw new RangeError(`More than ${MAX_SCALE} decimal digits`);
    const units = BigInt(`${int}${frac}`);
    return new Decimal(sign === '-' ? -units : units, frac.length);
  }

  /** Zero with the given scale. */
  static zero(scale = 0): Decimal {
    return new Decimal(0n, scale);
  }

  /** Returns true if the argument is a string accepted by {@link Decimal.from}. */
  static isDecimalString(value: string): boolean {
    const match = DECIMAL.exec(value.trim());
    return match !== null && (match[3] ?? '').length <= MAX_SCALE;
  }

  private rescale(scale: number): bigint {
    if (scale < this.scale) throw new RangeError('rescale would lose digits; use round()');
    return this.units * 10n ** BigInt(scale - this.scale);
  }

  add(other: Decimal | string | number): Decimal {
    const o = Decimal.from(other);
    const scale = Math.max(this.scale, o.scale);
    return new Decimal(this.rescale(scale) + o.rescale(scale), scale);
  }

  sub(other: Decimal | string | number): Decimal {
    return this.add(Decimal.from(other).neg());
  }

  mul(other: Decimal | string | number): Decimal {
    const o = Decimal.from(other);
    const product = new Decimal(this.units * o.units, this.scale + o.scale);
    return product.scale > MAX_SCALE ? product.round(MAX_SCALE) : product;
  }

  /** Divides by 10^n exactly (used for percentages: `x.mul(rate).shift(2)` = x × rate / 100). */
  shift(n: number): Decimal {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('shift expects a non-negative integer');
    const shifted = new Decimal(this.units, this.scale + n);
    return shifted.scale > MAX_SCALE ? shifted.round(MAX_SCALE) : shifted;
  }

  neg(): Decimal {
    return new Decimal(-this.units, this.scale);
  }

  abs(): Decimal {
    return this.units < 0n ? this.neg() : this;
  }

  /** -1, 0 or 1. */
  sign(): -1 | 0 | 1 {
    return this.units === 0n ? 0 : this.units < 0n ? -1 : 1;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  /** Compares numerically: -1, 0 or 1. */
  cmp(other: Decimal | string | number): -1 | 0 | 1 {
    const o = Decimal.from(other);
    const scale = Math.max(this.scale, o.scale);
    const a = this.rescale(scale);
    const b = o.rescale(scale);
    return a === b ? 0 : a < b ? -1 : 1;
  }

  eq(other: Decimal | string | number): boolean {
    return this.cmp(other) === 0;
  }

  /**
   * Rounds half away from zero to `digits` decimals: "per difetto se la terza cifra decimale è inferiore
   * a 5, per eccesso se uguale o superiore a 5" (Allegato A 1.9.1, rejection code 00421).
   */
  round(digits: number): Decimal {
    if (!Number.isInteger(digits) || digits < 0)
      throw new RangeError('digits must be a non-negative integer');
    if (digits >= this.scale) return new Decimal(this.rescale(digits), digits);
    const factor = 10n ** BigInt(this.scale - digits);
    const negative = this.units < 0n;
    const abs = negative ? -this.units : this.units;
    let quotient = abs / factor;
    if ((abs % factor) * 2n >= factor) quotient += 1n;
    return new Decimal(negative ? -quotient : quotient, digits);
  }

  /** Fixed-point string with exactly `digits` decimals (rounded half away from zero). */
  toFixed(digits: number): string {
    const rounded = this.round(digits);
    const negative = rounded.units < 0n;
    const abs = (negative ? -rounded.units : rounded.units).toString().padStart(digits + 1, '0');
    const int = abs.slice(0, abs.length - digits) || '0';
    const frac = abs.slice(abs.length - digits);
    return `${negative ? '-' : ''}${int}${digits > 0 ? `.${frac}` : ''}`;
  }

  /**
   * Fixed-point string with at least `min` and at most `max` decimals, trailing zeros beyond `min`
   * removed. Used for the FatturaPA `Amount8DecimalType` / `QuantitaType` (2 to 8 decimals).
   */
  toFixedRange(min: number, max: number): string {
    const text = this.toFixed(max);
    if (max === min) return text;
    const [int, frac = ''] = text.split('.');
    let end = frac.length;
    while (end > min && frac[end - 1] === '0') end -= 1;
    return `${int}.${frac.slice(0, end)}`;
  }

  /** Canonical string without trailing zeros. */
  toString(): string {
    return this.scale === 0 ? this.units.toString() : this.toFixedRange(0, this.scale).replace(/\.$/, '');
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Sums a list of decimals (empty sum = 0). */
export function sum(values: Iterable<Decimal | string | number>): Decimal {
  let total = Decimal.zero();
  for (const value of values) total = total.add(value);
  return total;
}
