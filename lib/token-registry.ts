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

export function normalizeAmount(faucetId: string, rawAmount: string): number {
  const n = Number(rawAmount);
  if (Number.isNaN(n)) throw new Error(`Invalid token amount for faucet ${faucetId}: "${rawAmount}"`);
  const decimals = getDecimals(faucetId);
  if (decimals === 0) return n;
  return n / Math.pow(10, decimals);
}
