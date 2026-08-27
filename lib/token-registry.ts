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
 * Convert a raw on-chain base-unit amount string into a human-scale number.
 *
 * Uses BigInt for the base-unit value so amounts above Number.MAX_SAFE_INTEGER
 * are not silently rounded before decimal scaling (unlike `Number(rawAmount)`).
 */
export function normalizeAmount(faucetId: string, rawAmount: string): number {
  let amount: bigint;
  try {
    amount = BigInt(rawAmount);
  } catch {
    throw new Error(`Invalid token amount for faucet ${faucetId}: "${rawAmount}"`);
  }

  const decimals = getDecimals(faucetId);
  if (decimals === 0) {
    return Number(amount);
  }

  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const factor = 10n ** BigInt(decimals);
  const whole = abs / factor;
  const fraction = abs % factor;
  // Build via decimal string so large base units stay exact through scaling;
  // the final Number() is only applied after dividing by 10^decimals.
  const scaled = Number(`${whole.toString()}.${fraction.toString().padStart(decimals, "0")}`);
  return negative ? -scaled : scaled;
}
