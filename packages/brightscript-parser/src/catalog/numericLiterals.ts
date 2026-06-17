/**
 * BrightScript numeric literal type inference.
 *
 * Recognizes all BrightScript numeric literal formats and returns the
 * corresponding type name:
 *
 * - **Integer**: plain decimal (`255`), hex (`&HFF`), `%` suffix (`125%`)
 * - **Float**: decimal point (`2.01`), `E` exponent (`1.23456E+30`), `!` suffix (`2!`)
 * - **Double**: `D` exponent (`1.23456789D-12`), `#` suffix (`2.3#`), 10+ digit decimals
 * - **LongInteger**: `&` suffix (`9876543210&`), hex with `&` suffix (`&hFEDCBA9876543210&`)
 *
 * @see https://developer.roku.com/dev/docs/expressions-variables-types#numeric-literals
 */

export type NumericType = 'Integer' | 'Float' | 'Double' | 'LongInteger';

/**
 * Matches all valid BrightScript numeric literal forms in a single pass.
 * Anchored to start/end so it validates the entire string.
 *
 * Groups:
 *  1 – hex body:  `&H` prefix forms (`&HFF`, `&hFF&`)
 *  2 – hex trailing `&` (present → LongInteger)
 *  3 – decimal body (everything else)
 */
const NUMERIC_LITERAL_RE =
  /^-?(?:(&[Hh][0-9A-Fa-f]+)(&)?|(\d+\.?\d*|\d*\.\d+)(?:[Ee][+-]?\d+|[Dd][+-]?\d+)?[%!#&]?)$/;

/**
 * Regex that matches a BrightScript numeric literal *anywhere* in a string.
 * Useful for stripping literals from code before identifier scanning.
 *
 * Uses word-boundary-like assertions: the hex form is preceded by a
 * non-word char (or start) and the decimal form cannot be preceded by
 * a letter/underscore (to avoid matching inside identifiers).
 */
export const NUMERIC_LITERAL_GLOBAL_RE =
  /(?:&[Hh][0-9A-Fa-f]+&?|(?<!\w)(?:\d+\.?\d*|\d*\.\d+)(?:[EeDd][+-]?\d+)?[%!#&]?)/g;

/**
 * Returns the BrightScript type of a numeric literal, or `undefined` if
 * the string is not a valid numeric literal.
 */
export function inferNumericLiteralType(value: string): NumericType | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const m = NUMERIC_LITERAL_RE.exec(trimmed);
  if (!m) return undefined;

  const hexBody = m[1];
  const hexTrailingAmpersand = m[2];
  const decimalBody = m[3];

  // ── Hex literals ──────────────────────────────────────────────────────────
  if (hexBody) {
    return hexTrailingAmpersand ? 'LongInteger' : 'Integer';
  }

  // ── Decimal literals ──────────────────────────────────────────────────────
  if (decimalBody !== undefined) {
    const full = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
    const suffix = full.slice(-1);

    // Explicit type suffix characters
    if (suffix === '&') return 'LongInteger';
    if (suffix === '#') return 'Double';
    if (suffix === '!') return 'Float';
    if (suffix === '%') return 'Integer';

    // D exponent → Double
    if (/[Dd][+-]?\d+$/.test(full)) return 'Double';

    // E exponent → Float
    if (/[Ee][+-]?\d+$/.test(full)) return 'Float';

    // Decimal point → Float
    if (full.includes('.')) return 'Float';

    // 10+ digits → Double (per Roku spec)
    const digits = full.replace(/\D/g, '');
    if (digits.length >= 10) return 'Double';

    return 'Integer';
  }

  return undefined;
}

/**
 * Quick check: is the value a valid BrightScript numeric literal?
 */
export function isNumericLiteral(value: string): boolean {
  return inferNumericLiteralType(value) !== undefined;
}

/**
 * Replaces all numeric literals in a line with spaces, preserving offsets.
 * This prevents hex digit sequences (e.g. `HFF` in `&HFF`) from being
 * mistaken for identifiers during analysis.
 */
export function stripNumericLiterals(line: string): string {
  return line.replace(NUMERIC_LITERAL_GLOBAL_RE, (match) => '0'.repeat(match.length));
}
