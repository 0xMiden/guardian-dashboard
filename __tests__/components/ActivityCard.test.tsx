import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivityCard } from "@/components/overview/ActivityCard";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("ActivityCard", () => {
  it("says what the headline counts and lists every state, proposals named apart", () => {
    useSWR.mockReturnValue({
      data: { deltaStatusCounts: { candidate: 0, canonical: 717, discarded: 4, retained: 15 }, inFlightProposalCount: 2 },
    });
    render(<ActivityCard />);
    expect(screen.getByText("717", { selector: ".text-stat" })).toBeInTheDocument();
    expect(screen.getByText("confirmed transactions, all time")).toBeInTheDocument();
    expect(screen.getByText("Discarded")).not.toBeVisible();
    fireEvent.click(screen.getByLabelText("Breakdown"));
    for (const label of ["Confirmed", "Submitted", "Recovering", "Discarded", "Proposals awaiting signatures"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
