import { describe, it, expect } from "vitest";
import { toBech32Id, toHexId } from "@/lib/account-id";

// A real pair from the Lambda testnet Guardian: what `accountIdBech32` holds for this hex id.
const HEX = "0xc8050a7222eae00145f99cbec61298";
const BECH32 = "mtst1aryq2znjyt4wqq29lxwta3sjnqlnthj9";

describe("toBech32Id", () => {
  it("spells a hex id the way the Guardian's accountIdBech32 does", async () => {
    expect(await toBech32Id(HEX, "MidenTestnet")).toBe(BECH32);
    expect(await toHexId(BECH32)).toBe(HEX);
  });

  it("uses the mdev prefix for devnet and local", async () => {
    expect((await toBech32Id(HEX, "MidenDevnet"))?.startsWith("mdev1")).toBe(true);
    expect(await toBech32Id(HEX, "MidenLocal")).toBe(await toBech32Id(HEX, "MidenDevnet"));
  });

  // An EVM address is not a Miden account, and a network the SDK cannot spell
  // gets no guess: the caller shows hex in both cases.
  it("declines what it cannot spell", async () => {
    expect(await toBech32Id("0x1234567890abcdef1234567890abcdef12345678", "MidenTestnet")).toBeUndefined();
    expect(await toBech32Id(HEX, "Unknown")).toBeUndefined();
  });
});
