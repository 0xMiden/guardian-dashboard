import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { deltaStatusBadge, statusReasonText } from "@/components/transactions/activity-cells";

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
