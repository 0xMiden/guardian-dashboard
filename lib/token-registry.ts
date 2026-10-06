// Decimal info isn't available from the Guardian API; configure per faucet or set a global default.
// GUARDIAN_TOKEN_DECIMALS: JSON map of faucetId → decimals, e.g. '{"0xabc...": 8}'
// GUARDIAN_TOKEN_DECIMALS_DEFAULT: fallback for any unmapped faucet (default: 6)
let overrides: Record<string, number> = {};
try {
  overrides = JSON.parse(process.env.GUARDIAN_TOKEN_DECIMALS ?? "{}");
} catch {
  throw new Error("GUARDIAN_TOKEN_DECIMALS is not valid JSON — check your environment configuration");
}
const defaultDecimals = parseInt(process.env.GUARDIAN_TOKEN_DECIMALS_DEFAULT ?? "6", 10);
if (Number.isNaN(defaultDecimals)) {
  throw new Error(`GUARDIAN_TOKEN_DECIMALS_DEFAULT is not a valid integer: "${process.env.GUARDIAN_TOKEN_DECIMALS_DEFAULT}"`);
}

export function getDecimals(faucetId: string): number {
  return overrides[faucetId] ?? defaultDecimals;
}

/**
 * Base units to display units.
 *
 * Parsed as a BigInt rather than a Number because the Guardian's
 * `/dashboard/stats` returns per-faucet totals summed across every account, and
 * documents them as "a base-10 decimal string that may exceed `u64` and
 * `Number.MAX_SAFE_INTEGER`; use `BigInt(totalAmount)`". A single account's
 * balance never came close; a faucet's total across 23,000 of them does, and
 * `Number("9007199254740993")` silently returns the wrong integer.
 *
 * Dividing before converting keeps the whole part exact and leaves only the
 * fraction, which is below 1 by construction, to floating point.
 */
export function normalizeAmount(faucetId: string, rawAmount: string): number {
  let n: bigint;
  try {
    n = BigInt(rawAmount);
  } catch {
    throw new Error(`Invalid token amount for faucet ${faucetId}: "${rawAmount}"`);
  }
  const decimals = getDecimals(faucetId);
  if (decimals === 0) return Number(n);
  // Built from a string rather than `10n ** BigInt(decimals)`: the project
  // targets ES2017, where BigInt literals are not available.
  const scale = BigInt("1" + "0".repeat(decimals));
  return Number(n / scale) + Number(n % scale) / Number(scale);
}
