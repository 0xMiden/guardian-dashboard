import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountsPanel, ACCOUNTS_KEY } from "@/components/accounts/AccountsPanel";
import posthog from "posthog-js";
import { FetchError } from "@/lib/utils";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;
const { useRouter, useSearchParams } = await import("next/navigation");

beforeEach(() => vi.clearAllMocks());

// Arriving from the Overview frozen count. The filter is server-side, unlike
// the chips and the search box, so the panel has to ask the node for it rather
// than filter what it already holds.
describe("AccountsPanel frozen-only", () => {
  it("asks the node for paused accounts and says the table is filtered", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("paused=true") as never);
    // Keyed by URL: a blanket mockReturnValue hands the accounts payload to
    // StatStrip as well, which then reads stats fields off it.
    useSWR.mockImplementation((key: string) =>
      key === "/api/accounts?limit=500&paused=true"
        ? { data: { items: [{
            accountId: "0xfrozen", stateStatus: "available", authScheme: "falcon",
            authorizedSignerCount: 2, hasPendingCandidate: false,
            pausedAt: "2026-07-01T00:00:00Z", pausedReason: "review",
            createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
          }], nextCursor: null }, error: undefined }
        : { data: undefined, error: undefined },
    );
    render(<AccountsPanel />);

    expect(useSWR).toHaveBeenCalledWith(
      "/api/accounts?limit=500&paused=true",
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByText(/showing frozen accounts only/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /show all accounts/i })).toHaveAttribute("href", "/accounts");
  });

  // "No accounts registered" would be a lie to someone who arrived from the
  // frozen count, and would leave them with no way back.
  it("says nothing is frozen rather than that the server is empty", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("paused=true") as never);
    useSWR.mockImplementation((key: string) =>
      key === "/api/accounts?limit=500&paused=true"
        ? { data: { items: [], nextCursor: null }, error: undefined }
        : { data: undefined, error: undefined },
    );
    render(<AccountsPanel />);

    expect(screen.getByText(/no accounts are frozen/i)).toBeInTheDocument();
    expect(screen.queryByText(/no accounts registered/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /show all accounts/i })).toBeInTheDocument();
  });

  it("asks for everything when the param is absent", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never);
    useSWR.mockImplementation((key: string) =>
      key === "/api/accounts?limit=500"
        ? { data: { items: [], nextCursor: null }, error: undefined }
        : { data: undefined, error: undefined },
    );
    render(<AccountsPanel />);

    expect(useSWR).toHaveBeenCalledWith("/api/accounts?limit=500", expect.anything(), expect.anything());
    expect(screen.queryByText(/showing frozen accounts only/i)).not.toBeInTheDocument();
  });
});

describe("AccountsPanel", () => {
  it("shows skeletons while loading", () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined });
    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll(".animate-pulse, [data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  // A failure that reached the node arrives from `fetcher` as a FetchError
  // carrying its status, which is what lets the panel name the problem instead
  // of echoing HTTP at the reader.
  it("names the node as unavailable when it did not answer", () => {
    useSWR.mockReturnValue({ data: undefined, error: new FetchError("Node offline", 503) });
    render(<AccountsPanel />);
    expect(screen.getByText("Guardian node unavailable")).toBeInTheDocument();
    expect(screen.getByText("Node offline")).toBeInTheDocument();
  });

  it("names the missing permission rather than the status code", () => {
    useSWR.mockReturnValue({
      data: undefined,
      error: new FetchError("You don't have permission to do that", 403, {
        code: "insufficient_operator_permission",
        missingPermissions: ["accounts:pause"],
      }),
    });
    render(<AccountsPanel />);
    expect(screen.getByText(/accounts:pause/)).toBeInTheDocument();
  });

  // Anything that did not come from a fetch has no status to reason about, so
  // it gets the generic wording rather than a guess at the cause.
  it("falls back to generic wording for an error with no status", () => {
    useSWR.mockReturnValue({ data: undefined, error: new Error("") });
    render(<AccountsPanel />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("keeps showing cached accounts when a revalidation fails", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items: [{
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
      if (key === ACCOUNTS_KEY) return { data: { items: [{
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
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("badges a released account, and released wins over frozen", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items: [{
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
    expect(screen.queryByText("frozen")).not.toBeInTheDocument();
  });

  it("badges ecdsa 2-signer accounts as wallet and filters on it", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items: [
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
      if (key === ACCOUNTS_KEY) return { data: { items: [
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
      if (key === ACCOUNTS_KEY) return { data: { items: [
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
      if (key === ACCOUNTS_KEY) return { data: { items: [
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
      if (key === ACCOUNTS_KEY) return { data: { items: [
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
      if (key === ACCOUNTS_KEY) return { data: { items: [account], nextCursor: null }, error: undefined };
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

describe("AccountsPanel sorting and export", () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    accountId: id, stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 2,
    hasPendingCandidate: false, pausedAt: null, pausedReason: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  });

  function mockRows(items: ReturnType<typeof row>[]) {
    useSWR.mockImplementation((key: string) =>
      key === ACCOUNTS_KEY
        ? { data: { items, nextCursor: null }, error: undefined }
        : { data: undefined, error: undefined });
  }

  const idsInOrder = (container: HTMLElement) =>
    [...container.querySelectorAll("tr[data-account-id]")].map((r) => r.getAttribute("data-account-id"));

  it("leaves rows in the node's order until a header is clicked", () => {
    mockRows([row("0xb", { authorizedSignerCount: 9 }), row("0xa", { authorizedSignerCount: 1 })]);
    const { container } = render(<AccountsPanel />);
    expect(idsInOrder(container)).toEqual(["0xb", "0xa"]);
  });

  it("cycles a column through descending, ascending, then back to node order", () => {
    mockRows([row("0xb", { authorizedSignerCount: 9 }), row("0xa", { authorizedSignerCount: 1 })]);
    const { container } = render(<AccountsPanel />);
    const header = screen.getByRole("button", { name: /signers/i });

    fireEvent.click(header);
    expect(idsInOrder(container)).toEqual(["0xb", "0xa"]);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(header);
    expect(idsInOrder(container)).toEqual(["0xa", "0xb"]);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "none");
  });

  it("sorts by the date a row carries, not by the string", () => {
    mockRows([
      row("0xold", { createdAt: "2025-02-01T00:00:00.000Z" }),
      row("0xnew", { createdAt: "2026-11-30T00:00:00.000Z" }),
    ]);
    const { container } = render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /created/i }));
    expect(idsInOrder(container)).toEqual(["0xnew", "0xold"]);
  });

  it("renders the account id as a link so it can be opened in a new tab", () => {
    mockRows([row("0xabc")]);
    const { container } = render(<AccountsPanel />);
    expect(container.querySelector('a[href="/accounts/0xabc"]')).toBeTruthy();
  });

  it("disables export when the filter leaves no rows", () => {
    mockRows([row("0xabc")]);
    render(<AccountsPanel />);
    const button = screen.getByRole("button", { name: /export csv/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(screen.getByText("Wallet (0)"));
    expect(button).toBeDisabled();
  });
});

// The chips used to count the rows paged in, so they read "All (50)" on a node
// holding 1,418 and only moved when scrolling happened to load more.
describe("AccountsPanel kind counts", () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    accountId: id, stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
    hasPendingCandidate: false, pausedAt: null, pausedReason: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
  });

  function mock({ items, stats }: { items: unknown[]; stats?: unknown }) {
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items, nextCursor: null }, error: undefined };
      if (key === "/api/accounts/stats") return { data: stats, error: undefined };
      return { data: undefined, error: undefined };
    });
  }

  it("counts what the node holds, not the page that has been loaded", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 1418, count7d: 0, count30d: 0, counted: 1418, wallet: 1410, other: 8 },
    });
    render(<AccountsPanel />);
    expect(screen.getByText("All (1,418)")).toBeInTheDocument();
    expect(screen.getByText("Wallet (1,410)")).toBeInTheDocument();
    expect(screen.getByText("Other (8)")).toBeInTheDocument();
  });

  // Below the table rather than beside the chips: sitting in the chip row it
  // read as a fourth filter rather than as a note on the table's completeness.
  it("says how much of the node the table is showing", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 1418, count7d: 0, count30d: 0, counted: 1418, wallet: 1410, other: 8 },
    });
    render(<AccountsPanel />);
    expect(screen.getByText(/Showing 2 of 1,418/)).toBeInTheDocument();
  });

  it("omits the loaded note once every account is on screen", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 2, count7d: 0, count30d: 0, counted: 2, wallet: 2, other: 0 },
    });
    render(<AccountsPanel />);
    expect(screen.queryByText(/loaded$/)).not.toBeInTheDocument();
  });

  it("falls back to the loaded rows before the walk has answered", () => {
    mock({ items: [row("0xa"), row("0xb", { authScheme: "falcon" })], stats: undefined });
    render(<AccountsPanel />);
    expect(screen.getByText("All (2)")).toBeInTheDocument();
    expect(screen.getByText("Wallet (1)")).toBeInTheDocument();
    expect(screen.getByText("Other (1)")).toBeInTheDocument();
  });
});
