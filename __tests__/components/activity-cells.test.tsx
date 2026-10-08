import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { activityLabel, deltaStatusBadge, statusReasonText } from "@/components/transactions/activity-cells";

/**
 * Guardian 0.16.1 added a fourth delta status, `retained` (issue #345): a
 * candidate the worker gave up verifying but keeps for background
 * reconciliation. Verified live on the OZ Guardian, whose retained rows carry
 * `status_reason` of `retry_exhausted` or `diverged`.
 */
describe("deltaStatusBadge", () => {
  it("names the states an operator recognises", () => {
    const { rerender } = render(deltaStatusBadge("canonical"));
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    rerender(deltaStatusBadge("candidate"));
    expect(screen.getByText("submitted")).toBeInTheDocument();
  });

  // "retained" is the wire's word for it. It still has a chance of recovering,
  // which "recovering" conveys and the raw status does not.
  it("calls a retained delta recovering", () => {
    render(deltaStatusBadge("retained"));
    expect(screen.getByText("recovering")).toBeInTheDocument();
  });

  it("explains why it stalled, when the Guardian says", () => {
    render(deltaStatusBadge("retained", "retry_exhausted"));
    expect(screen.getByTitle(/ran out of retries/)).toBeInTheDocument();
  });

  // A status this build has never heard of must still render as itself rather
  // than vanishing, the way `retained` did before 0.16.1.
  it("falls back to the raw status for anything unknown", () => {
    render(deltaStatusBadge("something_new"));
    expect(screen.getByText("something_new")).toBeInTheDocument();
  });
});

describe("statusReasonText", () => {
  it("translates the documented reasons", () => {
    expect(statusReasonText("retry_exhausted")).toMatch(/retries/);
    expect(statusReasonText("diverged")).toMatch(/chain/);
    expect(statusReasonText("client_abandoned")).toMatch(/client/);
  });

  // The client types this as an open string so new server labels never fail
  // decoding, so an unknown one has to stay readable.
  it("makes an unknown reason readable rather than dropping it", () => {
    expect(statusReasonText("some_new_reason")).toBe("some new reason");
  });

  it("is absent when the Guardian gave no reason", () => {
    expect(statusReasonText(undefined)).toBeUndefined();
  });
});

/**
 * Miden testnet v0.16 put two new proposal types on the wire, both filed under
 * the generic `custom` category: `recallable_send` and `bridged_send`. A fleet
 * walk on 2026-09-10 found 942 of 2,233 deltas were `custom + recallable_send`,
 * so preferring the category label named 42% of activity "Custom".
 */
describe("activityLabel", () => {
  it("names the types the new testnet brought", () => {
    expect(activityLabel("custom", "recallable_send")).toBe("Recallable send");
    expect(activityLabel("custom", "bridged_send")).toBe("Bridged send");
    expect(activityLabel("custom", "swap")).toBe("Swap");
  });

  // The proposal type is the more specific view of the same event, so it wins.
  // The same inversion used to call an add_signer delta "Account changed".
  it("prefers the proposal type over the category it arrives with", () => {
    expect(activityLabel("account_storage_change", "add_signer")).toBe("Signer added");
    expect(activityLabel("account_storage_change", "remove_signer")).toBe("Signer removed");
    expect(activityLabel("note_consumption", "consume_notes")).toBe("Note consumed");
  });

  it("still labels a delta that carries no proposal type", () => {
    expect(activityLabel("note_creation")).toBe("Note created");
    expect(activityLabel("guardian_switch")).toBe("Switch Guardian");
  });

  // Proposals reach this with no category at all.
  it("labels a proposal from its type alone", () => {
    expect(activityLabel(undefined, "switch_guardian")).toBe("Switch Guardian");
  });

  // A category this build has never heard of is still passed through rather
  // than replaced by "State change", which would throw away what the Guardian
  // did say. Reached only when the proposal type cannot name itself; a type
  // that can now wins, which is what "title-cases a type nobody has curated
  // yet" below asserts.
  it("passes an unknown category through as a last resort", () => {
    expect(activityLabel("some_new_category", "Payload_Shaped")).toBe("some_new_category");
    expect(activityLabel("some_new_category", undefined)).toBe("some_new_category");
  });

  it("has a last resort when the Guardian gives neither", () => {
    expect(activityLabel()).toBe("State change");
  });

  // Proposal types are defined by the applications on Miden, not by the
  // Guardian, and every one of them arrives under the `custom` category. Four
  // new ones appeared between 2026-09-10 and 2026-10-06, so an unlisted type
  // has to read as itself rather than as "Custom".
  it("sentence-cases a type nobody has curated yet", () => {
    expect(activityLabel("custom", "earn_deposit")).toBe("Earn deposit");
    expect(activityLabel("custom", "live_send")).toBe("Live send");
    expect(activityLabel("custom", "b2agg")).toBe("B2agg");
  });

  it("prefers a curated label over the derived one", () => {
    // Title-casing these would give "P2id" and "Midenid Register".
    expect(activityLabel("asset_transfer", "p2id")).toBe("Asset transfer");
    expect(activityLabel("custom", "midenid_register")).toBe("Miden ID registered");
  });

  // `custom_transaction` really is an arbitrary script, so the generic word is
  // the honest label and must survive the derived path.
  it("keeps custom_transaction generic", () => {
    expect(activityLabel("custom", "custom_transaction")).toBe("Custom");
  });

  // The live one is `usdcx_v1_` + ~1,500 characters of base32 holding a JSON
  // recipe. That payload must never reach a table cell.
  it("names the application behind an encoded payload without printing it", () => {
    const encoded = "usdcx_v1_" + "pmrhezldnfygkvtfojzws33oei5dclbcmfrxi2lp".repeat(40);
    expect(activityLabel("custom", encoded)).toBe("USDCx");
  });

  // Anything that does not look like a short deliberate token falls back to the
  // category instead of being truncated into nonsense.
  it("declines to derive a label from a payload-shaped type", () => {
    expect(activityLabel("custom", "x".repeat(400))).toBe("Custom");
    expect(activityLabel("custom", "Not_A_Wire_Token")).toBe("Custom");
    expect(activityLabel(undefined, "y".repeat(400))).toBe("State change");
  });
});
