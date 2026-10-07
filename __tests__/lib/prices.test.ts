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

/**
 * The chain reads go through the SDK the real module loads. Everything else in
 * the SDK stays real (the bech32 conversion below depends on it); only the RPC
 * client and the faucet-component decoder are replaced, keyed by account id.
 */
const chain: Record<string, { vault?: string[]; faucet?: { symbol: string; decimals: number } }> = {};
vi.mock("@/lib/falcon", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/falcon")>();
  class FakeRpcClient {
    async getAccountDetails(id: { toString(): string }) {
      const entry = chain[id.toString().toLowerCase()];
      if (!entry) throw new Error(`account ${id} not found`);
      return {
        account: () => ({
          vault: () => ({ fungibleAssets: () => (entry.vault ?? []).map((f) => ({ faucetId: () => ({ toString: () => f }) })) }),
          storage: () => entry,
        }),
      };
    }
  }
  const FakeFaucet = {
    fromAccountStorage: (entry: { faucet?: { symbol: string; decimals: number } }) => {
      if (!entry.faucet) throw new Error("not a faucet");
      return { symbol: () => ({ toString: () => entry.faucet!.symbol }), decimals: () => entry.faucet!.decimals };
    },
  };
  return {
    ...real,
    loadSdk: async () => ({ ...(await real.loadSdk()), RpcClient: FakeRpcClient, Endpoint: class {}, BasicFungibleFaucetComponent: FakeFaucet }),
  };
});

// The testnet faucet service's dispenser and the native USDCx faucet it hands
// out, as read live on 2026-10-07.
const DISPENSER = "mtst1ap8xldq06tm2252qmuky9ha4kunjzkhn";
const DISPENSER_HEX = "0x4e6fb40fd2f6a55140df2c42dfb5b7";
const NATIVE_HEX = "0x4cbdcaffe75f0a317482224dae6436";

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
  for (const k of Object.keys(chain)) delete chain[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
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

  // The post-reset testnet: every account holds the native USDCx, which no
  // list names yet. Bread prices it from the chain, and so does this.
  it("prices the native faucet at a fixed $1 when the chain says it is USDCX", async () => {
    chain[DISPENSER_HEX] = { vault: [NATIVE_HEX] };
    chain[NATIVE_HEX] = { faucet: { symbol: "USDCX", decimals: 6 } };
    mockFetch({ ...defaultRoutes(), "faucet-api.testnet.miden.io/get_metadata": { id: DISPENSER, decimals: 6 } });
    const { priceBook } = await freshModule();
    const book = await priceBook("MidenTestnet");
    // Gaylord's Gateway account on 2026-10-07: 9,867 units, $0.0099 in Bread.
    expect(book.usd(NATIVE_HEX, "9867")).toBeCloseTo(0.009867, 9);
  });

  it("leaves a native token with any other symbol unpriced", async () => {
    chain[DISPENSER_HEX] = { vault: [NATIVE_HEX] };
    chain[NATIVE_HEX] = { faucet: { symbol: "MIDEN", decimals: 6 } };
    mockFetch({ ...defaultRoutes(), "faucet-api.testnet.miden.io/get_metadata": { id: DISPENSER } });
    const { priceBook } = await freshModule();
    expect((await priceBook("MidenTestnet")).usd(NATIVE_HEX, "9867")).toBeUndefined();
  });

  // A dispenser holding two tokens is some other service. Guessing which one is
  // native is how a wrong price starts, so neither is priced.
  it("declines to guess when the dispenser holds more than one token", async () => {
    chain[DISPENSER_HEX] = { vault: [NATIVE_HEX, IETH_HEX] };
    chain[NATIVE_HEX] = { faucet: { symbol: "USDCX", decimals: 6 } };
    mockFetch({ ...defaultRoutes(), "faucet-api.testnet.miden.io/get_metadata": { id: DISPENSER } });
    const { priceBook } = await freshModule();
    expect((await priceBook("MidenTestnet")).usd(NATIVE_HEX, "9867")).toBeUndefined();
  });

  // A faucet calling itself USDCX is not the native one. Bread's fixed quote is
  // for the chain's fee asset only (#1131: anyone can mint a symbol).
  it("does not price a non-native faucet that merely calls itself USDCX", async () => {
    chain[DISPENSER_HEX] = { vault: [NATIVE_HEX] };
    chain[NATIVE_HEX] = { faucet: { symbol: "USDCX", decimals: 6 } };
    chain["0x2222222222222222222222222222bb"] = { faucet: { symbol: "USDCX", decimals: 6 } };
    mockFetch({ ...defaultRoutes(), "faucet-api.testnet.miden.io/get_metadata": { id: DISPENSER } });
    const { priceBook } = await freshModule();
    expect((await priceBook("MidenTestnet")).usd("0x2222222222222222222222222222bb", "1000000")).toBeUndefined();
  });

  it("asks the faucet service and the chain once per network, not per call", async () => {
    chain[DISPENSER_HEX] = { vault: [NATIVE_HEX] };
    chain[NATIVE_HEX] = { faucet: { symbol: "USDCX", decimals: 6 } };
    const fetch = mockFetch({ ...defaultRoutes(), "faucet-api.testnet.miden.io/get_metadata": { id: DISPENSER } });
    const { priceBook } = await freshModule();
    await priceBook("MidenTestnet");
    await priceBook("MidenTestnet");
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("faucet-api"))).toHaveLength(1);
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
    // Mainnet has no faucet service; a 404 there is "no native price", not an error.
    expect(asked.some((u) => u.includes("faucet-api.devnet.miden.io"))).toBe(true);
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
