import { describe, it, expect } from "vitest";
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

});
