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
// the chips and the search box, so the panel has to ask the Guardian for it rather
// than filter what it already holds.
describe("AccountsPanel frozen-only", () => {
  it("asks the Guardian for paused accounts and says the table is filtered", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("state=frozen") as never);
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
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("state=frozen") as never);
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

  // A failure that reached the Guardian arrives from `fetcher` as a FetchError
  // carrying its status, which is what lets the panel name the problem instead
  // of echoing HTTP at the reader.
  it("names the Guardian as unavailable when it did not answer", () => {
    useSWR.mockReturnValue({ data: undefined, error: new FetchError("Guardian offline", 503) });
    render(<AccountsPanel />);
    expect(screen.getByText("Guardian unavailable")).toBeInTheDocument();
    expect(screen.getByText("Guardian offline")).toBeInTheDocument();
  });

  // The panel used to return early on error, taking the toolbar with it, so
  // the Refresh that is the way out of that state was gone. Activity kept its
  // toolbar; now both do.
  it("keeps the toolbar up when the Guardian did not answer", () => {
    useSWR.mockReturnValue({ data: undefined, error: new FetchError("Guardian offline", 503) });
    render(<AccountsPanel />);
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByText("Any status")).toBeInTheDocument();
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
    expect(screen.queryByText(/Guardian unavailable/i)).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByText("Wallet"));
    expect(screen.getByText("0xwallet")).toBeInTheDocument();
    expect(screen.queryByText("0xsdk")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Other"));
    expect(screen.getByText("0xsdk")).toBeInTheDocument();
    expect(screen.queryByText("0xwallet")).not.toBeInTheDocument();
  });

  // Switching an account's Guardian leaves the old one with a released row
  // beside its active ones (2026-10-07, Gateway). The state chips act on the
  // loaded rows like the kind chips, so they combine with them.
  it("filters on lifecycle state, combined with the kind chips", () => {
    const now = new Date().toISOString();
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items: [
        { accountId: "0xactive", stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: now },
        { accountId: "0xfrozen", stateStatus: "available", authScheme: "falcon", authorizedSignerCount: 3,
          hasPendingCandidate: false, pausedAt: now, pausedReason: "review", updatedAt: now },
        { accountId: "0xreleased", stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, releasedAt: now, updatedAt: now },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    fireEvent.click(screen.getByText("Released"));
    expect(screen.getByText("0xreleased")).toBeInTheDocument();
    expect(screen.queryByText("0xactive")).not.toBeInTheDocument();
    expect(screen.queryByText("0xfrozen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Other"));
    expect(screen.queryByText("0xreleased")).not.toBeInTheDocument();
    expect(screen.getByText(/no released other accounts among the 3 loaded so far/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Any status"));
    expect(screen.getByText("0xfrozen")).toBeInTheDocument();
  });

  // Frozen is also the Guardian's own paused filter. Picking another chip has
  // to drop it, or "Any status" would still show the frozen set.
  it("leaves the server-side frozen set when another status chip is picked", () => {
    const replace = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace } as never);
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("state=frozen") as never);
    useSWR.mockImplementation(() => ({ data: { items: [], nextCursor: null }, error: undefined }));
    render(<AccountsPanel />);
    expect(screen.getByRole("button", { name: "Frozen" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Any status"));
    expect(replace).toHaveBeenCalledWith("/accounts");
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never);
  });

  // The Overview lifecycle counts link here; the chip they name is already selected.
  it("preselects the status chip named in the URL", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("state=released") as never);
    useSWR.mockImplementation((key: string) => {
      if (key === ACCOUNTS_KEY) return { data: { items: [
        { accountId: "0xactive", stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, updatedAt: "2026-10-08T00:00:00Z" },
        { accountId: "0xreleased", stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
          hasPendingCandidate: false, pausedAt: null, pausedReason: null, releasedAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" },
      ], nextCursor: null }, error: undefined };
      return { data: undefined, error: undefined };
    });
    render(<AccountsPanel />);
    expect(screen.getByRole("button", { name: "Released" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("0xreleased")).toBeInTheDocument();
    expect(screen.queryByText("0xactive")).not.toBeInTheDocument();
    // clearAllMocks keeps a mockReturnValue, so the next test would read it too.
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as never);
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
    fireEvent.click(screen.getByText("Wallet"));
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

    // A row that only answers to a mouse leaves the detail page unreachable
    // from the keyboard. Enter on the focused row opens it; Enter on a link
    // inside the row is that link's own business.
    const tr = screen.getByText("0xabc123").closest("tr")!;
    expect(tr).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(tr, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByText("0xabc123"), { key: "Enter" });
    expect(mockPush).toHaveBeenCalledTimes(2);
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

  it("leaves rows in the Guardian's order until a header is clicked", () => {
    mockRows([row("0xb", { authorizedSignerCount: 9 }), row("0xa", { authorizedSignerCount: 1 })]);
    const { container } = render(<AccountsPanel />);
    expect(idsInOrder(container)).toEqual(["0xb", "0xa"]);
  });

  it("cycles a column through descending, ascending, then back to Guardian order", () => {
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
    fireEvent.click(screen.getByText("Wallet"));
    expect(button).toBeDisabled();
  });
});

// The note under the table counts what the Guardian holds, from its aggregate,
// so it does not read "of 50" on a Guardian holding 1,418.
describe("AccountsPanel loaded note", () => {
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

  // The chips carry no counts: the aggregate cannot fill every group under
  // every filter, and a row where one group counts and the other does not
  // reads as two controls. They are named after the columns they filter.
  it("names the chips after their columns, without counts", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 1418, count7d: 0, count30d: 0 },
    });
    render(<AccountsPanel />);
    expect(screen.getByText("Any type")).toBeInTheDocument();
    expect(screen.getByText("Any status")).toBeInTheDocument();
    expect(screen.queryByText(/\(1,418\)/)).not.toBeInTheDocument();
  });

  // Below the table rather than beside the chips: sitting in the chip row it
  // read as a fourth filter rather than as a note on the table's completeness.
  it("says how much of the Guardian the table is showing", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 1418, count7d: 0, count30d: 0 },
    });
    render(<AccountsPanel />);
    expect(screen.getByText(/Showing 2 of 1,418/)).toBeInTheDocument();
  });

  it("omits the loaded note once every account is on screen", () => {
    mock({
      items: [row("0xa"), row("0xb")],
      stats: { total: 2, count7d: 0, count30d: 0 },
    });
    render(<AccountsPanel />);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("omits the note before the aggregate has answered", () => {
    mock({ items: [row("0xa"), row("0xb", { authScheme: "falcon" })], stats: undefined });
    render(<AccountsPanel />);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });
});
