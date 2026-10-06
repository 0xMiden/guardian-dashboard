import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The dashboard prices assets the way the Miden wallet (Bread) does, read from
 * 0xMiden/wallet on 2026-10-07: Binance spot prices, a faucet allowlist built
 * from the verified token list and wallet-config, USDCX fixed at $1, and no
 * figure at all for anything else. These cases pin each of those rules.
 */

const TOKEN_LIST = {
  tokens: [
    // Real testnet entries. IETH's bech32 id converts to the hex the Guardian uses.
    { network: "testnet", faucetId: "mtst1arcf9xpxfrc7wygpv744ytgr6cw2df6h", symbol: "IETH", name: "IETH", decimals: 8 },
    { network: "testnet", faucetId: "mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec", symbol: "MIDEN", name: "Miden", decimals: 6 },
    { network: "testnet", faucetId: "0x1111111111111111111111111111aa", symbol: "USDCX", name: "USDCx", decimals: 6 },
  ],
};
const IETH_HEX = "0xf092982648f1e7110167ab522d03d6";
const MIDEN_HEX = "0x18101fa522c174b165efd4f70a0385";
const USDC_HEX = "0x537c15a622074e91188aa894456c52";
const WALLET_CONFIG = { network: "testnet", epoch: { midenUsdcFaucet: USDC_HEX } };
const TICKER = [
  { symbol: "USDCUSD", price: "0.99981000" },
  { symbol: "BTCUSD", price: "85346.10000000" },
  { symbol: "ETHUSD", price: "2693.61000000" },
];

type Routes = Record<string, unknown | (() => unknown)>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fetch that answers by URL substring: a body, a Response, or a thrower. */
function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [needle, answer] of Object.entries(routes)) {
      if (!url.includes(needle)) continue;
      const body = typeof answer === "function" ? (answer as () => unknown)() : answer;
      return body instanceof Response ? body : json(body);
    }
    return json({ error: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const defaultRoutes = (): Routes => ({
  "token-list/main/testnet.json": TOKEN_LIST,
  "wallet-config/main/testnet.json": WALLET_CONFIG,
  "api.binance.com": TICKER,
});

async function freshModule() {
  vi.resetModules();
  return import("@/lib/prices");
}

beforeEach(() => {
  vi.stubEnv("GUARDIAN_PRICED_FAUCETS", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("priceBook", () => {
  it("prices a listed IETH holding at ETH with the list's decimals", async () => {
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    // 1.5 IETH at 8 decimals.
    expect(book.usd(IETH_HEX, "150000000")).toBeCloseTo(1.5 * 2693.61, 6);
  });

  // The Guardian spells ids in hex, the list in bech32. Both spellings of one
  // faucet must land on one entry, whichever the caller holds.
  it("matches the Guardian's hex spelling against the list's bech32", async () => {
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(IETH_HEX.toUpperCase().replace("0X", "0x"), "100000000")).toBeCloseTo(2693.61, 6);
  });

  // Verified is not priced. MIDEN is on the list and has no market.
  it("gives a listed token nothing prices no figure", async () => {
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(MIDEN_HEX, "1000000")).toBeUndefined();
  });

  it("gives an unlisted faucet no figure", async () => {
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd("0x4cbdcaffe75f0a317482224dae6436", "39468")).toBeUndefined();
  });

  it("prices the Epoch USDC faucet from wallet-config at USDCUSD", async () => {
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(USDC_HEX, "3000000")).toBeCloseTo(3 * 0.99981, 6);
  });

  it("fixes USDCX at one dollar without asking the feed", async () => {
    const fetch = mockFetch({ ...defaultRoutes(), "api.binance.com": () => { throw new Error("down"); } });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd("0x1111111111111111111111111111aa", "2500000")).toBe(2.5);
    expect(fetch.mock.calls.some((c) => String(c[0]).includes("binance"))).toBe(true);
  });

  // Bread's rule for a listed symbol without a quote: no price, never $1 or $0.
  it("leaves a listed faucet unpriced while the feed is unreachable", async () => {
    mockFetch({ ...defaultRoutes(), "api.binance.com": () => { throw new Error("down"); } });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(IETH_HEX, "100000000")).toBeUndefined();
  });

  it("treats a zero quote as no quote", async () => {
    mockFetch({ ...defaultRoutes(), "api.binance.com": [{ symbol: "ETHUSD", price: "0.00000000" }] });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(IETH_HEX, "100000000")).toBeUndefined();
  });

  it("takes an env entry for a faucet no list names, such as bridged ETH", async () => {
    vi.stubEnv("GUARDIAN_PRICED_FAUCETS", JSON.stringify({ "0x0B372F2735E33E91216D995BF29B91": { priceSymbol: "ETH", decimals: 8 } }));
    mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    // 0.6 ETH, the Gateway wallet's deposit in the Sep 22 extract.
    expect(book.usd("0x0b372f2735e33e91216d995bf29b91", "60000000")).toBeCloseTo(0.6 * 2693.61, 6);
  });

  it("rejects a malformed env entry at load", async () => {
    vi.stubEnv("GUARDIAN_PRICED_FAUCETS", JSON.stringify({ "0x0b372f2735e33e91216d995bf29b91": { priceSymbol: "DOGE", decimals: 8 } }));
    mockFetch(defaultRoutes());
    await expect(freshModule()).rejects.toThrow(/GUARDIAN_PRICED_FAUCETS/);
  });

  // Bread's parseTokenList rule: one bad token rejects the document, since a
  // partial list would misprice the holders of the dropped token.
  it("rejects a token list with one malformed entry, whole", async () => {
    const broken = { tokens: [...TOKEN_LIST.tokens, { network: "testnet", faucetId: IETH_HEX, symbol: "IBTC" }] };
    mockFetch({ ...defaultRoutes(), "token-list/main/testnet.json": broken });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    expect(book.usd(IETH_HEX, "100000000")).toBeUndefined();
    // wallet-config is a separate document and still stands.
    expect(book.usd(USDC_HEX, "1000000")).toBeCloseTo(0.99981, 6);
  });

  // Devnet today: the repo has no devnet.json. That is a network with nothing
  // listed, not a failure to be retried or logged.
  it("reads a 404 list as an empty one", async () => {
    const fetch = mockFetch({ "api.binance.com": TICKER });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenDevnet");
    expect(book.usd(IETH_HEX, "100000000")).toBeUndefined();
    const asked = fetch.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => u.endsWith("/token-list/main/devnet.json"))).toBe(true);
    expect(asked.some((u) => u.endsWith("/wallet-config/main/devnet.json"))).toBe(true);
  });

  it("keeps the last good prices when a refresh fails", async () => {
    vi.useFakeTimers();
    try {
      let feedUp = true;
      mockFetch({ ...defaultRoutes(), "api.binance.com": () => { if (!feedUp) throw new Error("down"); return TICKER; } });
      const { priceBook } = await freshModule();
      expect((await priceBook("MidenTestnet")).usd(IETH_HEX, "100000000")).toBeCloseTo(2693.61, 6);

      feedUp = false;
      vi.advanceTimersByTime(6 * 60_000); // past the 5-minute price TTL
      expect((await priceBook("MidenTestnet")).usd(IETH_HEX, "100000000")).toBeCloseTo(2693.61, 6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one request between concurrent callers", async () => {
    const fetch = mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    await Promise.all([priceBook("MidenTestnet"), priceBook("MidenTestnet"), priceBook("MidenTestnet")]);
    const binance = fetch.mock.calls.filter((c) => String(c[0]).includes("binance"));
    expect(binance).toHaveLength(1);
  });

  it("asks Binance for exactly Bread's three pairs", async () => {
    const fetch = mockFetch(defaultRoutes());
    const { priceBook } = await freshModule();
    await priceBook("MidenTestnet");
    const url = decodeURIComponent(String(fetch.mock.calls.find((c) => String(c[0]).includes("binance"))![0]));
    expect(url).toBe('https://api.binance.com/api/v3/ticker/price?symbols=["ETHUSD","BTCUSD","USDCUSD"]');
  });
});

describe("normalizeAmount", () => {
  it("scales by the given decimals", async () => {
    const { normalizeAmount } = await freshModule();
    expect(normalizeAmount("0xf", "1000000", 6)).toBe(1);
    expect(normalizeAmount("0xf", "500000", 6)).toBe(0.5);
    expect(normalizeAmount("0xf", "0", 6)).toBe(0);
    expect(normalizeAmount("0xf", "42", 0)).toBe(42);
  });

  it("throws on a non-integer amount string", async () => {
    const { normalizeAmount } = await freshModule();
    expect(() => normalizeAmount("0xf", "abc", 6)).toThrow(/Invalid token amount/);
    expect(() => normalizeAmount("0xf", "1.5", 6)).toThrow(/Invalid token amount/);
  });

  // `/dashboard/stats` sums one faucet across every account and documents the
  // result as possibly exceeding Number.MAX_SAFE_INTEGER.
  it("keeps full precision above Number.MAX_SAFE_INTEGER", async () => {
    const { normalizeAmount } = await freshModule();
    expect(normalizeAmount("0xf", "9007199254740993000000", 6)).toBe(9007199254740993);
  });
});
