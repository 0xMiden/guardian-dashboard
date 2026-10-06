import { loadSdk } from "@/lib/falcon";

/**
 * What a faucet's amount is worth in US dollars, the way the Miden wallet
 * (Bread, 0xMiden/wallet) answers it. There is no oracle. Read from its source
 * on 2026-10-07:
 *
 * - Spot prices come from Binance's public ticker for three pairs, ETHUSD,
 *   BTCUSD and USDCUSD (`src/lib/prices/binance.ts`, `KNOWN_SYMBOLS`). No key.
 * - A faucet is priced by its id, never by the symbol it declares, because
 *   anyone can mint a token called ETH (wallet #1131). The ids come from the
 *   verified token list (`0xMiden/token-list`, one JSON per network) and from
 *   `0xMiden/wallet-config`'s Epoch USDC faucet. USDCX is fixed at $1
 *   (`src/lib/prices/fixed.ts`).
 * - Everything else has no dollar value. Not zero: `usd` says `undefined`, and
 *   a caller that sums must count those separately rather than fold them in.
 *
 * Bread reads one more source, the Agglayer bridge registry on chain, for the
 * faucet that mints bridged ETH. A serverless route has no Miden client to do
 * that read, so `GUARDIAN_PRICED_FAUCETS` carries that one entry by hand.
 *
 * Fetched documents are a trust boundary. A token list with one malformed entry
 * is rejected whole, as Bread does, since a partial list would misprice the
 * holders of the dropped token.
 */

export type PriceBook = {
  /** USD for a raw base-unit amount, or `undefined` when the faucet is unpriced. */
  usd(faucetId: string, rawAmount: string): number | undefined;
};

type PricedFaucet = { priceSymbol: string; decimals: number };
type Allowlist = Record<string, PricedFaucet>;

/** Bread's `KNOWN_SYMBOLS`: the price symbol and the Binance pair that quotes it. */
const PAIRS: Record<string, string> = { ETH: "ETHUSD", BTC: "BTCUSD", USDC: "USDCUSD" };
/** Quotes that never come from the feed. */
const FIXED: Record<string, number> = { USDCX: 1 };
/**
 * What a verified-list symbol stands for, as Bread's swap registry has it (IETH
 * at ETH, IBTC at BTC). A listed symbol absent here is verified but unpriced.
 */
const LISTED_AS: Record<string, string> = { IETH: "ETH", IBTC: "BTC", USDC: "USDC", USDCX: "USDCX" };

const BINANCE_URL =
  "https://api.binance.com/api/v3/ticker/price?symbols=" +
  encodeURIComponent(JSON.stringify(Object.values(PAIRS)));
const RAW = "https://raw.githubusercontent.com/0xMiden";

// Bread refreshes prices every five minutes and its config about hourly.
const PRICE_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

const HEX_ID = /^0x[0-9a-f]{30}$/i;

// Operator-supplied, parsed once like GUARDIAN_ENDPOINTS: a bad value should
// fail loudly at boot rather than silently price nothing.
const envFaucets: Allowlist = parseEnvFaucets(process.env.GUARDIAN_PRICED_FAUCETS);

function parseEnvFaucets(raw: string | undefined): Allowlist {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GUARDIAN_PRICED_FAUCETS is not valid JSON — check your environment configuration");
  }
  if (!isRecord(parsed)) throw new Error("GUARDIAN_PRICED_FAUCETS must be a JSON object keyed by faucet id");
  const out: Allowlist = {};
  for (const [id, entry] of Object.entries(parsed)) {
    if (!HEX_ID.test(id) || !isPricedFaucet(entry)) {
      throw new Error(`GUARDIAN_PRICED_FAUCETS: bad entry for "${id}" (want 0x-hex id → { priceSymbol, decimals })`);
    }
    out[id.toLowerCase()] = entry;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDecimals(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 30;
}

function isPricedFaucet(v: unknown): v is PricedFaucet {
  return isRecord(v) && typeof v.priceSymbol === "string" && v.priceSymbol in { ...PAIRS, ...FIXED } && isDecimals(v.decimals);
}

/**
 * Base units to display units. BigInt because `/dashboard/stats` sums one faucet
 * across every account and documents the total as possibly exceeding
 * `Number.MAX_SAFE_INTEGER`. Dividing before converting keeps the whole part
 * exact and leaves only the fraction, below 1 by construction, to floating point.
 */
export function normalizeAmount(faucetId: string, rawAmount: string, decimals: number): number {
  let n: bigint;
  try {
    n = BigInt(rawAmount);
  } catch {
    throw new Error(`Invalid token amount for faucet ${faucetId}: "${rawAmount}"`);
  }
  if (decimals === 0) return Number(n);
  // Built from a string rather than `10n ** BigInt(decimals)`: the project
  // targets ES2017, where BigInt literals are not available.
  const scale = BigInt("1" + "0".repeat(decimals));
  return Number(n / scale) + Number(n % scale) / Number(scale);
}

// ---------------------------------------------------------------------------
// One in-process cache for the three remote documents. The in-flight promise is
// what is stored, so concurrent callers share one request (Bread's single-flight
// refresh). A failed refresh keeps serving the last good value for another TTL
// (Bread keeps its last good copy); with nothing good to fall back on it throws,
// and `priceBook` treats that as an empty document.
// ponytail: per-instance, so each cold Vercel instance fetches once. Upgrade
// path is Vercel KV keyed the same way; both routes are force-dynamic, which
// Next documents as making every fetch no-store, so the Data Cache is not it.

type Entry = { promise: Promise<unknown>; at: number };
const cache = new Map<string, Entry>();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = load().catch((err) => {
    if (hit) {
      cache.set(key, { promise: hit.promise, at: now });
      return hit.promise as Promise<T>;
    }
    cache.delete(key);
    throw err;
  });
  cache.set(key, { promise, at: now });
  return promise;
}

/** Test seam. */
export function __resetPriceCaches(): void {
  cache.clear();
}

/** The document, or `null` on 404: a network with no list is not an error. */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadPrices(): Promise<Record<string, number>> {
  const body = await fetchJson(BINANCE_URL);
  if (!Array.isArray(body)) throw new Error("Binance: unexpected body");
  const bySymbol: Record<string, number> = {};
  for (const [symbol, pair] of Object.entries(PAIRS)) {
    const ticker = body.find((t) => isRecord(t) && t.symbol === pair);
    const price = isRecord(ticker) ? parseFloat(String(ticker.price)) : NaN;
    // A zero or unparseable price is no quote, not a free token.
    if (price > 0) bySymbol[symbol] = price;
  }
  return bySymbol;
}

/** The Guardian's spelling of a faucet id: lowercase hex, from bech32 if needed. */
async function toHexId(id: string): Promise<string> {
  if (HEX_ID.test(id)) return id.toLowerCase();
  const { Address } = await loadSdk();
  return Address.fromBech32(id).accountId().toString().toLowerCase();
}

async function loadTokenList(network: string): Promise<Allowlist> {
  const body = await fetchJson(`${RAW}/token-list/main/${encodeURIComponent(network)}.json`);
  if (body === null) return {};
  if (!isRecord(body) || !Array.isArray(body.tokens)) throw new Error("token-list: unexpected body");
  const out: Allowlist = {};
  for (const token of body.tokens) {
    if (
      !isRecord(token) ||
      typeof token.network !== "string" ||
      typeof token.faucetId !== "string" ||
      typeof token.symbol !== "string" ||
      !isDecimals(token.decimals)
    ) {
      throw new Error("token-list: malformed token entry");
    }
    const priceSymbol = LISTED_AS[token.symbol];
    if (token.network !== network || !priceSymbol) continue;
    out[await toHexId(token.faucetId)] = { priceSymbol, decimals: token.decimals };
  }
  return out;
}

async function loadWalletConfig(network: string): Promise<Allowlist> {
  const body = await fetchJson(`${RAW}/wallet-config/main/${encodeURIComponent(network)}.json`);
  if (body === null || !isRecord(body)) return {};
  const epoch = isRecord(body.epoch) ? body.epoch : {};
  const faucet = epoch.midenUsdcFaucet;
  if (typeof faucet !== "string" || !HEX_ID.test(faucet)) return {};
  // The Epoch collateral USDC. Bread reads its decimals from the faucet on
  // chain; USDC is 6 everywhere it exists.
  return { [faucet.toLowerCase()]: { priceSymbol: "USDC", decimals: 6 } };
}

/** `MidenTestnet` as the endpoint config spells it → `testnet` as the repos do. */
function repoNetwork(network: string): string {
  return network.replace(/^Miden/, "").toLowerCase();
}

const empty = <T,>(): Record<string, T> => ({});

export async function priceBook(network: string): Promise<PriceBook> {
  const net = repoNetwork(network);
  const [list, config, prices] = await Promise.all([
    cached(`list:${net}`, LIST_TTL_MS, () => loadTokenList(net)).catch(empty<PricedFaucet>),
    cached(`config:${net}`, LIST_TTL_MS, () => loadWalletConfig(net)).catch(empty<PricedFaucet>),
    cached("prices", PRICE_TTL_MS, loadPrices).catch(empty<number>),
  ]);
  // The env entry is the operator's explicit word, so it wins over a list.
  const faucets: Allowlist = { ...list, ...config, ...envFaucets };
  return {
    usd(faucetId, rawAmount) {
      const entry = faucets[faucetId.toLowerCase()];
      if (!entry) return undefined;
      const price = FIXED[entry.priceSymbol] ?? prices[entry.priceSymbol];
      // A listed faucet whose quote is missing (feed down) is unpriced for now,
      // never $1 or $0: Bread's rule for a listed symbol without a quote.
      if (!(price > 0)) return undefined;
      return normalizeAmount(faucetId, rawAmount, entry.decimals) * price;
    },
  };
}
