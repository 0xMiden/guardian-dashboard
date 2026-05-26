import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountsPanel } from "@/components/accounts/AccountsPanel";
import posthog from "posthog-js";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;
const { useRouter } = await import("next/navigation");

beforeEach(() => vi.clearAllMocks());

describe("AccountsPanel", () => {
  it("shows skeletons while loading", () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined });
    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll(".animate-pulse, [data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  it("shows error message when guardian is unavailable", () => {
    useSWR.mockReturnValue({ data: { available: false, error: "Node offline" }, error: undefined });
    render(<AccountsPanel />);
    expect(screen.getByText("Node offline")).toBeInTheDocument();
  });

  it("shows empty state when no accounts", () => {
    useSWR.mockReturnValue({ data: { items: [], nextCursor: null }, error: undefined });
    render(<AccountsPanel />);
    expect(screen.getByText(/no accounts registered/i)).toBeInTheDocument();
  });

  it("renders account rows", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [{
        accountId: "0xabc123",
        stateStatus: "available",
        authScheme: "falcon",
        authorizedSignerCount: 2,
        hasPendingCandidate: false,
        pausedAt: null,
        pausedReason: null,
        updatedAt: new Date().toISOString(),
      }], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    expect(screen.getByText("0xabc123")).toBeInTheDocument();
    expect(screen.getByText("available")).toBeInTheDocument();
  });

  it("fires account_clicked PostHog event and navigates on row click", () => {
    const mockPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as any);
    const account = {
      accountId: "0xabc123",
      stateStatus: "available",
      authScheme: "falcon",
      authorizedSignerCount: 1,
      hasPendingCandidate: false,
      pausedAt: null,
      pausedReason: null,
      updatedAt: new Date().toISOString(),
    };
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [account], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    fireEvent.click(screen.getByText("0xabc123").closest("tr")!);
    expect(posthog.capture).toHaveBeenCalledWith("account_clicked", {
      account_id: "0xabc123",
      account_status: "available",
      has_pending_candidate: false,
    });
    expect(mockPush).toHaveBeenCalledWith("/accounts/0xabc123");
  });
});
