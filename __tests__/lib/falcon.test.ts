import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes } from "@/lib/falcon";

describe("bytesToHex", () => {
  it("converts bytes to hex string", () => {
    expect(bytesToHex(new Uint8Array([0, 255, 128]))).toBe("00ff80");
  });

  it("pads single-digit hex values", () => {
    expect(bytesToHex(new Uint8Array([1, 2, 15]))).toBe("01020f");
  });

  it("returns empty string for empty array", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });
});

describe("hexToBytes", () => {
  it("converts hex string to bytes", () => {
    expect(hexToBytes("00ff80")).toEqual(new Uint8Array([0, 255, 128]));
  });

  it("strips 0x prefix", () => {
    expect(hexToBytes("0x00ff80")).toEqual(new Uint8Array([0, 255, 128]));
  });

  it("roundtrips correctly", () => {
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    expect(hexToBytes(bytesToHex(original))).toEqual(original);
  });
});
