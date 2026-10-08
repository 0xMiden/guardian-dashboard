import type {
  DashboardDeltaDecodedNote,
  DashboardDeltaDetail,
  GuardianOperatorHttpClient,
  PagedResult,
} from "@openzeppelin/guardian-operator-client";
import { toBech32Id } from "@/lib/account-id";
import { priceBook, type PriceBook } from "@/lib/prices";

/**
 * What the Guardian leaves to the dashboard, added to its feeds before they
 * reach the browser: the bech32 spelling of every account id (the feeds give
 * hex, the Accounts list gives bech32, and a reader has to match the two by
 * eye), and the verified list's symbol and decimals beside every faucet id.
 * Both need the SDK, which only runs server-side.
 */
export type TokenInfo = { symbol?: string; decimals?: number };

const tokenOf = (book: PriceBook, faucetId: string | undefined): TokenInfo =>
  (faucetId && book.token(faucetId)) || {};

const spell = async <T extends { accountId?: string }>(item: T, network: string) =>
  ({ ...item, accountIdBech32: item.accountId ? await toBech32Id(item.accountId, network) : undefined });

type DeltaLike = {
  accountId?: string;
  counterparty?: { accountId: string };
  assets?: { assetId: string }[];
};

export async function enrichDeltas<T extends DeltaLike>(page: PagedResult<T>, network: string) {
  const book = await priceBook(network);
  const items = await Promise.all(
    page.items.map(async (d) => ({
      ...(await spell(d, network)),
      counterparty: d.counterparty && (await spell(d.counterparty, network)),
      assets: d.assets?.map((a) => ({ ...a, ...tokenOf(book, a.assetId) })),
    })),
  );
  return { ...page, items };
}

export async function enrichProposals<T extends { accountId?: string }>(page: PagedResult<T>, network: string) {
  return { ...page, items: await Promise.all(page.items.map((p) => spell(p, network))) };
}

// The package does not export the snapshot type, only the method that returns it.
type Snapshot = Awaited<ReturnType<GuardianOperatorHttpClient["getAccountSnapshot"]>>;

export async function enrichSnapshot(snapshot: Snapshot, network: string) {
  const book = await priceBook(network);
  return {
    ...snapshot,
    vault: {
      ...snapshot.vault,
      fungible: snapshot.vault.fungible.map((f) => ({
        ...f,
        ...tokenOf(book, f.faucetId),
        usd: book.usd(f.faucetId, f.amount),
      })),
    },
  };
}

export async function enrichDeltaDetail(detail: DashboardDeltaDetail, network: string) {
  const book = await priceBook(network);
  const note = async (n: DashboardDeltaDecodedNote) => ({
    ...n,
    senderBech32: n.sender ? await toBech32Id(n.sender, network) : undefined,
    recipientBech32: n.recipient ? await toBech32Id(n.recipient, network) : undefined,
    assets: n.assets.map((a) => ({ ...a, ...tokenOf(book, a.assetId) })),
  });
  return {
    ...(await spell(detail, network)),
    inputNotes: await Promise.all(detail.inputNotes.map(note)),
    outputNotes: await Promise.all(detail.outputNotes.map(note)),
    vaultChanges: detail.vaultChanges.map((c) => ({ ...c, ...tokenOf(book, c.assetId) })),
    proposal: detail.proposal && {
      ...detail.proposal,
      recipientIdBech32: detail.proposal.recipientId ? await toBech32Id(detail.proposal.recipientId, network) : undefined,
      ...tokenOf(book, detail.proposal.faucetId),
    },
  };
}
