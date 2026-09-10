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
    expect(activityLabel("custom", "recallable_send")).toBe("Recallable Send");
    expect(activityLabel("custom", "bridged_send")).toBe("Bridged Send");
    expect(activityLabel("custom", "swap")).toBe("Swap");
  });

  // The proposal type is the more specific view of the same event, so it wins.
  // The same inversion used to call an add_signer delta "Account Changed".
  it("prefers the proposal type over the category it arrives with", () => {
    expect(activityLabel("account_storage_change", "add_signer")).toBe("Signer Added");
    expect(activityLabel("account_storage_change", "remove_signer")).toBe("Signer Removed");
    expect(activityLabel("note_consumption", "consume_notes")).toBe("Note Consumed");
  });

  it("still labels a delta that carries no proposal type", () => {
    expect(activityLabel("note_creation")).toBe("Note Created");
    expect(activityLabel("guardian_switch")).toBe("Switch Guardian");
  });

  // Proposals reach this with no category at all.
  it("labels a proposal from its type alone", () => {
    expect(activityLabel(undefined, "switch_guardian")).toBe("Switch Guardian");
  });

  // A type this build has never heard of must fall back to the category rather
  // than to "State Change", which would throw away what the Guardian did say.
  it("falls back to the category for an unknown proposal type", () => {
    expect(activityLabel("custom", "custom_transaction")).toBe("Custom");
    expect(activityLabel("some_new_category", "some_new_type")).toBe("some_new_category");
  });

  it("has a last resort when the Guardian gives neither", () => {
    expect(activityLabel()).toBe("State Change");
  });
});
