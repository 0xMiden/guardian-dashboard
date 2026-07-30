export function truncateId(id: string, prefixLen = 10, suffixLen = 6): string {
  if (id.length <= prefixLen + suffixLen + 1) return id;
  return `${id.slice(0, prefixLen)}…${id.slice(-suffixLen)}`;
}

export function formatAmount(amount: string): string {
  const sign = amount[0] === "-" || amount[0] === "+" ? amount[0] : "";
  const digits = sign ? amount.slice(1) : amount;
  try {
    return sign + BigInt(digits).toLocaleString();
  } catch {
    return amount;
  }
}

const STORAGE_SLOT_LABELS: Record<string, string> = {
  "openzeppelin::multisig::threshold_config": "Multisig threshold",
  "openzeppelin::multisig::signers": "Authorized signers",
  "openzeppelin::multisig::nonce": "Nonce",
  "consumed_notes": "Consumed notes",
  "account_code": "Account code",
};

export function storageSlotLabel(slotName: string): string {
  return STORAGE_SLOT_LABELS[slotName] ?? slotName;
}

// ponytail: inferred from auth shape, since Guardian records nothing about
// which client registered an account. The Miden Wallet creates every account
// with ECDSA auth and two signers (hot + cold, alongside the guardian
// cosigner); older wallet builds registered a single key. Anyone using the
// multisig SDK with the same shape reads as a wallet account here. Upgrade
// path: the client-attribution field proposed upstream, which would replace
// this with a value the server actually recorded.
export function isWalletAccount(a: { authScheme: string; authorizedSignerCount: number }): boolean {
  return a.authScheme === "ecdsa" && a.authorizedSignerCount === 2;
}

// Substring match against every form of an account's id, so a hex query finds a
// row displayed in bech32 and the other way round. An empty query matches
// everything, which keeps the call sites free of `query ? ... : ...`.
export function matchesAccountId(query: string, ...ids: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return ids.some((id) => id?.toLowerCase().includes(q));
}

// A query long enough to be a whole account id rather than a partial one. Used
// to offer a direct open for an account that has not been paged in yet, which is
// the only way past the loaded-rows-only ceiling on the filter.
// Miden ids are 15 bytes: 30 hex characters, or bech32m under one of the
// network HRPs (`mm`, `mtst`, `mdev`).
export function looksLikeAccountId(query: string): boolean {
  return /^(0x[0-9a-f]{24,}|(mm|mtst|mdev)1[0-9a-z]{20,})$/i.test(query.trim());
}
