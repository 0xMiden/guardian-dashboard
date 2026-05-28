import { describe, it, expect } from "vitest";
import { truncateId, formatAmount, storageSlotLabel } from "@/lib/format";

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
