import { describe, it, expect } from "vitest";
import { truncateId, formatAmount, storageSlotLabel, accountState, toCsv, accountsToCsv, formatTimestamp, relativeTime } from "@/lib/format";

describe("truncateId", () => {
  it("returns short strings unchanged", () => {
    expect(truncateId("abc123", 10, 6)).toBe("abc123");
  });

  it("truncates long strings with ellipsis", () => {
    const id = "0x1234567890abcdef1234567890abcdef";
    const result = truncateId(id, 10, 6);
    expect(result).toBe("0x12345678…abcdef");
  });

  it("uses custom prefix and suffix lengths", () => {
    const id = "abcdefghijklmnopqrstuvwxyz";
    const result = truncateId(id, 4, 4);
    expect(result).toBe("abcd…wxyz");
  });
});

describe("formatAmount", () => {
  it("formats a plain positive number", () => {
    expect(formatAmount("1000000")).toBe("1,000,000");
  });

  it("preserves explicit + sign", () => {
    expect(formatAmount("+500")).toBe("+500");
  });

  it("preserves - sign", () => {
    expect(formatAmount("-1000")).toBe("-1,000");
  });

  it("returns original string for non-numeric input", () => {
    expect(formatAmount("invalid")).toBe("invalid");
  });

  it("handles zero", () => {
    expect(formatAmount("0")).toBe("0");
  });
});

describe("storageSlotLabel", () => {
  it("returns human-readable label for known keys", () => {
    expect(storageSlotLabel("openzeppelin::multisig::threshold_config")).toBe("Multisig threshold");
    expect(storageSlotLabel("openzeppelin::multisig::signers")).toBe("Authorized signers");
    expect(storageSlotLabel("consumed_notes")).toBe("Consumed notes");
  });

  it("returns the raw key for unknown slots", () => {
    expect(storageSlotLabel("some::unknown::slot")).toBe("some::unknown::slot");
  });
});

describe("accountState", () => {
  it("names the three states the operator acts on", () => {
    expect(accountState("available", null, null)).toBe("active");
    expect(accountState("available", "2026-01-01T00:00:00Z", null)).toBe("frozen");
    expect(accountState("available", null, "2026-01-01T00:00:00Z")).toBe("released");
  });

  it("prefers released over frozen, since released is terminal", () => {
    expect(accountState("available", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")).toBe("released");
  });

  it("passes through a status it does not recognise rather than inventing one", () => {
    expect(accountState("degraded", null, null)).toBe("degraded");
  });
});

describe("toCsv", () => {
  it("quotes only the fields that need it", () => {
    expect(toCsv([["plain", "with,comma", 'has"quote', "two\nlines"]]))
      .toBe('plain,"with,comma","has""quote","two\nlines"');
  });

  it("renders null and undefined as empty fields, not as text", () => {
    expect(toCsv([[null, undefined, 0]])).toBe(",,0");
  });

  it("separates rows with CRLF", () => {
    expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
  });
});

describe("accountsToCsv", () => {
  const account = {
    accountId: "0xabc",
    accountIdBech32: "mtst1abc",
    stateStatus: "available",
    pausedAt: null,
    releasedAt: null,
    authScheme: "ecdsa",
    authorizedSignerCount: 2,
    hasPendingCandidate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  it("exports both id forms, the state word and an ISO timestamp", () => {
    const [header, row] = accountsToCsv([account], { "0xabc": 1234.5 }).split("\r\n");
    expect(header).toBe("Account ID,Account ID (hex),Status,Type,Signers,Pending,Total assets (USD),Created,Updated");
    expect(row).toBe("mtst1abc,0xabc,active,wallet,2,,1234.5,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z");
  });

  it("leaves the assets field blank when the row's total was never fetched", () => {
    const row = accountsToCsv([account], {}).split("\r\n")[1];
    expect(row.split(",")[6]).toBe("");
  });

  it("does not claim an account is a wallet when the auth shape says otherwise", () => {
    const row = accountsToCsv([{ ...account, authScheme: "falcon" }], {}).split("\r\n")[1];
    expect(row.split(",")[3]).toBe("");
  });

  it("falls back to the hex id when the Guardian returns no bech32 form", () => {
    const row = accountsToCsv([{ ...account, accountIdBech32: null }], {}).split("\r\n")[1];
    expect(row.startsWith("0xabc,0xabc,")).toBe(true);
  });
});

// Phrasing is now pinned to en-US in lib/format.ts (see the LOCALE comment
// there), so these assert the literal strings an operator reads rather than
// re-deriving them from Intl. Deriving them made the comparison a tautology and
// made the suite's result depend on the host's locale: on a tr-TR machine the
// implementation and the expectation moved together and the assertion could not
// fail, while the formatAmount tests below — which do use literals — did.
const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

describe("formatTimestamp", () => {
  it("names the timezone it is expressed in", () => {
    const iso = "2026-01-02T03:04:00.000Z";
    const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")!.value;
    expect(formatTimestamp(iso)).toContain(tz);
  });

  it("passes a value it cannot parse straight through", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});

describe("relativeTime", () => {
  it("picks the largest unit that still describes the gap", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("30 seconds ago");
    expect(relativeTime(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
  });

  it("phrases a future timestamp forwards", () => {
    expect(relativeTime(ago(-2 * HOUR), NOW)).toBe("in 2 hours");
  });

  it("gives up past a week, where the date says more than the gap does", () => {
    expect(relativeTime(ago(6 * DAY), NOW)).not.toBeNull();
    expect(relativeTime(ago(8 * DAY), NOW)).toBeNull();
  });

  it("returns null rather than a bogus gap for an unparseable value", () => {
    expect(relativeTime("not a date", NOW)).toBeNull();
  });
});
