import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDecimals, normalizeAmount } from "@/lib/token-registry";

describe("getDecimals", () => {
  it("returns 6 for any unknown faucet (default)", () => {
    expect(getDecimals("0xunknown")).toBe(6);
  });
});

describe("normalizeAmount", () => {
  it("divides by 10^6 by default", () => {
    expect(normalizeAmount("0xfaucet", "1000000")).toBe(1);
  });

  it("returns 0 for zero amount", () => {
    expect(normalizeAmount("0xfaucet", "0")).toBe(0);
  });

  it("produces fractional results", () => {
    expect(normalizeAmount("0xfaucet", "500000")).toBe(0.5);
  });

  it("throws on non-numeric amount string", () => {
    expect(() => normalizeAmount("0xfaucet", "abc")).toThrow(/Invalid token amount/);
  });

  it("preserves precision for raw amounts above Number.MAX_SAFE_INTEGER", () => {
    // 9007199254740993 is the first integer Number() cannot represent exactly.
    const raw = "9007199254740993";
    expect(Number(raw)).toBe(9007199254740992); // documents the Number() trap
    // With default 6 decimals: 9_007_199_254.740993
    expect(normalizeAmount("0xfaucet", raw)).toBe(9_007_199_254.740993);
  });
});

describe("normalizeAmount with per-faucet decimals", () => {
  const original = process.env.GUARDIAN_TOKEN_DECIMALS;

  beforeEach(() => {
    vi.resetModules();
    process.env.GUARDIAN_TOKEN_DECIMALS = JSON.stringify({ "0x18dec": 18 });
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GUARDIAN_TOKEN_DECIMALS;
    } else {
      process.env.GUARDIAN_TOKEN_DECIMALS = original;
    }
    vi.resetModules();
  });

  it("scales 18-decimal balances that exceed MAX_SAFE_INTEGER in base units", async () => {
    const { normalizeAmount: normalize } = await import("@/lib/token-registry");
    // 10_000 whole tokens with 18 decimals — base units far above MAX_SAFE_INTEGER
    const raw = "10000000000000000000000";
    expect(BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(normalize("0x18dec", raw)).toBe(10_000);
  });
});
