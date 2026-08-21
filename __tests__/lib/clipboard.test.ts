import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyText } from "@/lib/clipboard";

beforeEach(() => {
  document.body.innerHTML = "";
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("copyText", () => {
  it("copies through execCommand without needing the Clipboard API", async () => {
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(true) });
    Object.assign(navigator, { clipboard: undefined });
    await expect(copyText("0xabc")).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to the Clipboard API when execCommand refuses", async () => {
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) });
    await expect(copyText("0xabc")).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0xabc");
  });

  it("reports failure when neither path is available", async () => {
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) });
    Object.assign(navigator, { clipboard: undefined });
    await expect(copyText("0xabc")).resolves.toBe(false);
  });

  it("reports failure when the Clipboard API rejects", async () => {
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(copyText("0xabc")).resolves.toBe(false);
  });

  // The scratch textarea used to be removed only on the success path, so a
  // throwing execCommand left it in the document.
  it("leaves no scratch element behind when execCommand throws", async () => {
    Object.assign(document, {
      execCommand: vi.fn(() => { throw new Error("not implemented"); }),
    });
    await copyText("0xabc");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("gives focus back to the element that had it", async () => {
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(true) });
    const input = document.body.appendChild(document.createElement("input"));
    input.focus();
    await copyText("0xabc");
    expect(document.activeElement).toBe(input);
  });
});
