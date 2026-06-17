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
 * Regex that matches a BrightScript numeric literal *anywhere* in a string.
 * Useful for stripping literals from code before identifier scanning.
 *
 * Uses word-boundary-like assertions: the hex form is preceded by a
 * non-word char (or start) and the decimal form cannot be preceded by
 * a letter/underscore (to avoid matching inside identifiers).
 */
export declare const NUMERIC_LITERAL_GLOBAL_RE: RegExp;
/**
 * Returns the BrightScript type of a numeric literal, or `undefined` if
 * the string is not a valid numeric literal.
 */
export declare function inferNumericLiteralType(value: string): NumericType | undefined;
/**
 * Quick check: is the value a valid BrightScript numeric literal?
 */
export declare function isNumericLiteral(value: string): boolean;
/**
 * Replaces all numeric literals in a line with spaces, preserving offsets.
 * This prevents hex digit sequences (e.g. `HFF` in `&HFF`) from being
 * mistaken for identifiers during analysis.
 */
export declare function stripNumericLiterals(line: string): string;
//# sourceMappingURL=numericLiterals.d.ts.map