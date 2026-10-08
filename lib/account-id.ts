import { loadSdk } from "@/lib/falcon";

const HEX_ID = /^0x[0-9a-f]{30}$/i;

/** The Guardian's spelling of a faucet or account id: lowercase hex, from bech32 if needed. */
export async function toHexId(id: string): Promise<string> {
  if (HEX_ID.test(id)) return id.toLowerCase();
  const { Address } = await loadSdk();
  return Address.fromBech32(id).accountId().toString().toLowerCase();
}

/** `MidenTestnet` as the endpoint config spells it → the SDK's network id, or none for a network the SDK cannot spell. */
async function networkId(network: string) {
  const { NetworkId } = await loadSdk();
  switch (network) {
    case "MidenMainnet": return NetworkId.mainnet();
    case "MidenTestnet": return NetworkId.testnet();
    // Both carry the `mdev` prefix, as the Guardian documents for `accountIdBech32`.
    case "MidenDevnet":
    case "MidenLocal": return NetworkId.devnet();
    default: return undefined;
  }
}

// ponytail: grows with every id seen, which is bounded by the fleet's account
// count; an LRU would matter only for a process that outlives many resets.
const spelled = new Map<string, string | null>();

/**
 * The bech32 spelling the Guardian itself puts in `accountIdBech32`, for an id
 * the feeds only give in hex. Undefined for an id that is not a Miden account
 * (an EVM address) or a network the SDK cannot spell, so the caller shows hex.
 */
export async function toBech32Id(hex: string, network: string): Promise<string | undefined> {
  if (!HEX_ID.test(hex)) return undefined;
  const key = `${network}:${hex.toLowerCase()}`;
  if (!spelled.has(key)) {
    const net = await networkId(network);
    if (!net) return undefined;
    const { AccountId, Address } = await loadSdk();
    try {
      spelled.set(key, Address.fromAccountId(AccountId.fromHex(hex)).toBech32(net));
    } catch {
      spelled.set(key, null);
    }
  }
  return spelled.get(key) ?? undefined;
}
