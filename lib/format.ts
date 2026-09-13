// Every formatter below pins its locale instead of passing `undefined`.
//
// `undefined` means "whatever locale the host resolved", which is the OS locale
// on the server and the browser locale on the client. Two consequences, both bad
// for an operator console:
//
//  1. The same Guardian reads differently to different operators — `1,000,000`
//     under en-US and `1.000.000` under tr-TR — and these numbers get compared
//     against Guardian log lines, CSV exports and counterparty records, where a
//     swapped group/decimal separator changes the value being read. This is the
//     cross-locale form of the drift the `formatCount` comment below already
//     fights within a single page.
//  2. The rest of the UI is English-only, so an unpinned locale mixed Turkish
//     relative times ("2 saat önce") into English sentences.
//
// This is language and separator only: no `timeZone` option is set anywhere, so
// timestamps still render in the reader's own zone and keep the `timeZoneName`
// that makes them comparable — the property formatTimestamp was written for.
//
// Exported for the handful of call sites that need their own option set (e.g. the
// "since <date>" line in GuardianStatusCard) so there is still one place to
// change if the dashboard ever becomes properly localized.
export const LOCALE = "en-US";

export function truncateId(id: string, prefixLen = 10, suffixLen = 6): string {
  if (id.length <= prefixLen + suffixLen + 1) return id;
  return `${id.slice(0, prefixLen)}…${id.slice(-suffixLen)}`;
}

export function formatAmount(amount: string): string {
  const sign = amount[0] === "-" || amount[0] === "+" ? amount[0] : "";
  const digits = sign ? amount.slice(1) : amount;
  try {
    return sign + BigInt(digits).toLocaleString(LOCALE);
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

// One word per account state, shared by the table badge, the detail page and
// the CSV export so the three cannot drift apart. `released` wins over `frozen`:
// an account that moved to another guardian is terminal for this Guardian, so an
// operator unfreeze can never bring it back.
export function accountState(
  status: string,
  pausedAt: string | null,
  releasedAt?: string | null,
): string {
  if (releasedAt) return "released";
  if (pausedAt) return "frozen";
  if (status === "available") return "active";
  return status;
}

// Counts carry a thousands separator wherever they are shown. Left to each
// call site this drifts: the stat strip formatted and the overview cards did
// not, so the same Guardian read "1,813" in one place and "1813" in another.
export function formatCount(n: number): string {
  return n.toLocaleString(LOCALE);
}

// USD totals, always to the cent. Same reasoning as `formatCount`: the call sites
// were each spelling out `toLocaleString(undefined, { minimumFractionDigits: 2,
// maximumFractionDigits: 2 })`, which repeated the options three times and left
// the locale unpinned in all three.
export function formatUsd(n: number): string {
  return n.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Past a week, "5 weeks ago" tells an operator less than the date does.
const RELATIVE_LIMIT = 7 * DAY;

// Absolute form, carrying the timezone it is expressed in. Every timestamp in
// the dashboard used to be a bare `toLocaleString()`, which renders identically
// whether the reader sits in UTC or JST and so cannot be compared against a log
// line or a counterparty's record.
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(LOCALE, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

// `null` when the gap is too wide to phrase usefully, or the input is not a
// date, which lets the caller fall back to `formatTimestamp` without repeating
// the range check.
export function relativeTime(iso: string, now: number = Date.now()): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs >= RELATIVE_LIMIT) return null;
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  if (abs < MINUTE) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}

// RFC 4180: a field containing a quote, comma or newline is quoted, and quotes
// inside it are doubled. Excel reads the result without an import dialog.
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// Timestamps go out as ISO rather than localized: a spreadsheet can sort and
// filter those, and they carry the timezone the rendered table leaves implicit.
export function accountsToCsv(
  accounts: {
    accountId: string;
    accountIdBech32?: string | null;
    stateStatus: string;
    pausedAt: string | null;
    releasedAt?: string | null;
    authScheme: string;
    authorizedSignerCount: number;
    hasPendingCandidate: boolean;
    createdAt: string;
    updatedAt: string;
  }[],
  assetTotals: Record<string, number>,
): string {
  return toCsv([
    ["Account ID", "Account ID (hex)", "Status", "Type", "Signers", "Pending", "Total assets (USD)", "Created", "Updated"],
    ...accounts.map((a) => [
      a.accountIdBech32 ?? a.accountId,
      a.accountId,
      accountState(a.stateStatus, a.pausedAt, a.releasedAt),
      isWalletAccount(a) ? "wallet" : "",
      a.authorizedSignerCount,
      a.hasPendingCandidate ? "pending" : "",
      // Blank rather than 0 when the row's total was never fetched: the export
      // must not claim an account holds nothing when nobody looked.
      assetTotals[a.accountId] ?? "",
      a.createdAt,
      a.updatedAt,
    ]),
  ]);
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
