// Decimal info isn't available from the Guardian API; configure per faucet or set a global default.
// GUARDIAN_TOKEN_DECIMALS: JSON map of faucetId → decimals, e.g. '{"0xabc...": 8}'
// GUARDIAN_TOKEN_DECIMALS_DEFAULT: fallback for any unmapped faucet (default: 6)
const overrides: Record<string, number> = JSON.parse(process.env.GUARDIAN_TOKEN_DECIMALS ?? "{}");
const defaultDecimals = parseInt(process.env.GUARDIAN_TOKEN_DECIMALS_DEFAULT ?? "6", 10);

export function getDecimals(faucetId: string): number {
  return overrides[faucetId] ?? defaultDecimals;
}

export function normalizeAmount(faucetId: string, rawAmount: string): number {
  const decimals = getDecimals(faucetId);
  if (decimals === 0) return Number(rawAmount);
  return Number(rawAmount) / Math.pow(10, decimals);
}
