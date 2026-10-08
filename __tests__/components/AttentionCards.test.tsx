import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttentionCards } from "@/components/overview/AttentionCards";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("AttentionCards", () => {
  it("links each non-zero lifecycle count to the Accounts table filtered to it", () => {
    useSWR.mockImplementation((key: string) => ({
      data: key === "/api/accounts/stats"
        ? { active: 1200, frozen: 0, released: 3 }
        : { latestActivity: "2026-10-08T10:00:00Z" },
    }));
    render(<AttentionCards />);
    expect(screen.getByRole("link", { name: "1,200" })).toHaveAttribute("href", "/accounts?state=active");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/accounts?state=released");
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("frozen leads to the Guardian's frozen set", () => {
    useSWR.mockImplementation((key: string) => ({
      data: key === "/api/accounts/stats" ? { active: 1, frozen: 2, released: 0 } : { latestActivity: null },
    }));
    render(<AttentionCards />);
    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute("href", "/accounts?state=frozen");
    expect(screen.getByText("Nothing recorded")).toBeInTheDocument();
  });

  // The old band said "None" for frozen on a Guardian that reports no counts at all.
  it("shows a dash rather than None when the Guardian has no aggregate", () => {
    useSWR.mockImplementation((key: string) => ({
      data: key === "/api/accounts/stats" ? { unsupported: true } : { latestActivity: null },
    }));
    render(<AttentionCards />);
    expect(screen.getAllByTitle("Needs Guardian 0.18.0")).toHaveLength(3);
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  // The counts are minutes old by design while the Accounts card is live.
  it("dates the counts with the aggregate's own timestamp", () => {
    useSWR.mockImplementation((key: string) => ({
      data: key === "/api/accounts/stats" ? { active: 1, frozen: 0, released: 0, asOf: "2026-10-08T10:05:00Z" } : { latestActivity: null },
    }));
    render(<AttentionCards />);
    expect(screen.getByText(/Statistics as of/)).toBeInTheDocument();
  });

  // Two skeletons that never ended, on a Guardian that refused both calls.
  it("shows a dash with the reason when the Guardian did not answer", () => {
    const error = Object.assign(new Error("Request failed (503)"), { status: 503 });
    useSWR.mockImplementation(() => ({ data: undefined, error }));
    render(<AttentionCards />);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
  });
});
