import { describe, it, expect, vi } from "vitest";
import { enrichDeltas, enrichSnapshot, enrichDeltaDetail } from "@/lib/enrich";

vi.mock("@/lib/account-id", () => ({
  toBech32Id: async (hex: string) => (hex === "0xaaa" ? "mtst1aaa" : undefined),
}));
vi.mock("@/lib/prices", () => ({
  priceBook: async () => ({
    token: (id: string) => (id === "0xf1" ? { symbol: "IETH", decimals: 8 } : undefined),
    usd: (id: string, raw: string) => (id === "0xf1" ? Number(raw) / 1e8 * 2000 : undefined),
  }),
}));

describe("enrich", () => {
  it("spells every account id both ways and names every faucet the list knows", async () => {
    const page = await enrichDeltas({
      items: [{ accountId: "0xaaa", counterparty: { accountId: "0xbbb" }, assets: [{ assetId: "0xf1" }, { assetId: "0xf2" }] }],
      nextCursor: null,
    }, "MidenTestnet");
    const [row] = page.items;
    expect(row.accountIdBech32).toBe("mtst1aaa");
    expect(row.counterparty?.accountIdBech32).toBeUndefined();
    expect(row.assets).toEqual([{ assetId: "0xf1", symbol: "IETH", decimals: 8 }, { assetId: "0xf2" }]);
  });

  it("prices a vault entry beside its name", async () => {
    const snapshot = await enrichSnapshot({
      commitment: "0x1", updatedAt: "t", hasPendingCandidate: false,
      vault: { fungible: [{ faucetId: "0xf1", amount: "100000000" }, { faucetId: "0xf2", amount: "5" }], nonFungible: [] },
    } as never, "MidenTestnet");
    expect(snapshot.vault.fungible[0]).toEqual({ faucetId: "0xf1", amount: "100000000", symbol: "IETH", decimals: 8, usd: 2000 });
    expect(snapshot.vault.fungible[1]).toEqual({ faucetId: "0xf2", amount: "5", usd: undefined });
  });

  it("reaches the ids and faucets inside notes and the proposal", async () => {
    const detail = await enrichDeltaDetail({
      accountId: "0xaaa", nonce: 1, status: "canonical", statusTimestamp: "t", prevCommitment: "0x", newCommitment: null,
      inputNotes: [], outputNotes: [{ noteId: "n", tag: "p2id", sender: "0xaaa", recipient: "0xbbb", assets: [{ assetId: "0xf1", kind: "fungible", amount: "1" }] }],
      vaultChanges: [{ kind: "fungible", assetId: "0xf1", change: "-1" }], storageChanges: [],
      proposal: { proposalType: "p2id", recipientId: "0xaaa", faucetId: "0xf1", amount: "1" },
    } as never, "MidenTestnet");
    expect(detail.outputNotes[0]).toMatchObject({ senderBech32: "mtst1aaa", recipientBech32: undefined, assets: [{ symbol: "IETH", decimals: 8 }] });
    expect(detail.vaultChanges[0]).toMatchObject({ symbol: "IETH", decimals: 8 });
    expect(detail.proposal).toMatchObject({ recipientIdBech32: "mtst1aaa", symbol: "IETH", decimals: 8 });
  });
});
