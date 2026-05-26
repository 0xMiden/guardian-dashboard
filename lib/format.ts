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
