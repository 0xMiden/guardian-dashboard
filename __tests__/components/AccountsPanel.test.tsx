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

  it("shows the server error message when guardian is unavailable", () => {
    useSWR.mockReturnValue({ data: undefined, error: new Error("Node offline") });
    render(<AccountsPanel />);
    expect(screen.getByText("Node offline")).toBeInTheDocument();
  });

  it("shows generic error when the error has no message", () => {
    useSWR.mockReturnValue({ data: undefined, error: new Error("") });
    render(<AccountsPanel />);
    expect(screen.getByText(/guardian node unavailable/i)).toBeInTheDocument();
  });

  it("keeps showing cached accounts when a revalidation fails", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [{
        accountId: "0xabc123",
        stateStatus: "available",
        authScheme: "falcon",
        authorizedSignerCount: 2,
        hasPendingCandidate: false,
        pausedAt: null,
        pausedReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }], nextCursor: null }, error: new Error("503") };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    expect(screen.getByText("0xabc123")).toBeInTheDocument();
    expect(screen.queryByText(/guardian node unavailable/i)).not.toBeInTheDocument();
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

  it("badges a released account, and released wins over paused", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [{
        accountId: "0xreleased",
        stateStatus: "available",
        authScheme: "falcon",
        authorizedSignerCount: 2,
        hasPendingCandidate: false,
        pausedAt: new Date().toISOString(),
        pausedReason: "incident",
        releasedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    expect(screen.getByText("released")).toBeInTheDocument();
    expect(screen.queryByText("paused")).not.toBeInTheDocument();
  });

  it("badges ecdsa 2-signer accounts as wallet and filters on it", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [
        { accountId: "0xwallet", stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
        { accountId: "0xsdk", stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 3,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    expect(screen.getByText("wallet")).toBeInTheDocument();
    expect(screen.getByText("Wallet (1)")).toBeInTheDocument();
    expect(screen.getByText("Other (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Wallet (1)"));
    expect(screen.getByText("0xwallet")).toBeInTheDocument();
    expect(screen.queryByText("0xsdk")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Other (1)"));
    expect(screen.getByText("0xsdk")).toBeInTheDocument();
    expect(screen.queryByText("0xwallet")).not.toBeInTheDocument();
  });

  it("says so when a filter matches nothing in the loaded rows", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [
        { accountId: "0xsdk", stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 3,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    fireEvent.click(screen.getByText("Wallet (0)"));
    expect(screen.getByText(/no wallet accounts among the 1 loaded so far/i)).toBeInTheDocument();
  });

  it("narrows the rows to an account ID substring, in either encoding", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [
        { accountId: "0xaaa111", accountIdBech32: "mtst1aaa111", stateStatus: "available", authScheme: "falcon",
          authorizedSignerCount: 3, hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
        { accountId: "0xbbb222", accountIdBech32: "mtst1bbb222", stateStatus: "available", authScheme: "falcon",
          authorizedSignerCount: 3, hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    const input = screen.getByLabelText("Filter by account ID");

    // A hex fragment finds the row even though the table renders bech32.
    fireEvent.change(input, { target: { value: "bbb2" } });
    expect(screen.getByText("mtst1bbb222")).toBeInTheDocument();
    expect(screen.queryByText("mtst1aaa111")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear filter"));
    expect(screen.getByText("mtst1aaa111")).toBeInTheDocument();
  });

  // The filter can only see rows that have been paged in, so a whole ID that is
  // not loaded yet gets a way through: the account page needs no search endpoint.
  it("offers a direct open for a full account ID that is not loaded", () => {
    const mockPush = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as any);
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [
        { accountId: "0xaaa111", stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 3,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    const input = screen.getByLabelText("Filter by account ID");

    fireEvent.change(input, { target: { value: "0xnotloaded" } });
    expect(screen.queryByText(/open this account directly/i)).not.toBeInTheDocument();

    const full = "0x16f6c85d5652c9200879145bfdda93";
    fireEvent.change(input, { target: { value: full } });
    fireEvent.click(screen.getByText(/open this account directly/i));
    expect(mockPush).toHaveBeenCalledWith(`/accounts/${full}`);
  });

  // Auto layout re-measured every column when a filter swapped the mounted
  // rows, so the whole table jumped sideways on each chip click.
  it("pins the column widths so switching filters cannot shift the table", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/accounts") return { data: { items: [
        { accountId: "0xaaa111", stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 3,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: new Date().toISOString() },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    const { container } = render(<AccountsPanel />);
    const table = container.querySelector("table")!;
    expect(table.className).toContain("table-fixed");
    expect(table.querySelectorAll("colgroup col").length).toBe(
      table.querySelectorAll("thead th").length,
    );
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
