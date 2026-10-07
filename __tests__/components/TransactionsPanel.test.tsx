import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return { ...actual, default: vi.fn(), mutate: vi.fn(async () => undefined) };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const { TransactionsPanel } = await import("@/components/transactions/TransactionsPanel");
const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;
const { mutate } = await import("swr");

const delta = (accountId: string, nonce: number) => ({
  accountId,
  nonce,
  status: "canonical",
  category: "transfer",
  statusTimestamp: new Date().toISOString(),
  assets: undefined,
  counterparty: undefined,
});

const stats = { total: 42, count7d: 7, count30d: 30 };

function mockFeeds(deltas: unknown[], proposals: unknown[] = [], withStats = true, nextCursor: string | null = null) {
  useSWR.mockImplementation((key: string) => {
    if (typeof key === "string" && key.startsWith("/api/global-deltas")) {
      return { data: { items: deltas, nextCursor }, error: undefined };
    }
    if (key === "/api/global-proposals") return { data: { items: proposals, nextCursor: null }, error: undefined };
    if (key === "/api/accounts/stats") return { data: withStats ? stats : undefined, error: undefined };
    return { data: undefined, error: undefined };
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
});
afterEach(() => fetchSpy.mockRestore());

describe("TransactionsPanel", () => {
  it("renders the Guardian's inventory strip above the feed", () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("narrows the feed to an account ID substring", () => {
    mockFeeds([delta("0xaaa111", 1), delta("0xbbb222", 1)]);
    render(<TransactionsPanel />);
    expect(screen.getByText("0xbbb222")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by account ID"), { target: { value: "aaa1" } });
    expect(screen.getByText("0xaaa111")).toBeInTheDocument();
    expect(screen.queryByText("0xbbb222")).not.toBeInTheDocument();
  });

  // A failed proposals fetch used to count as "still loading", so the skeleton
  // never cleared even though the deltas had arrived.
  it("still lists the deltas when the proposals feed fails", () => {
    useSWR.mockImplementation((key: string) => {
      if (typeof key === "string" && key.startsWith("/api/global-deltas")) {
        return { data: { items: [delta("0xaaa111", 1)], nextCursor: null }, error: undefined };
      }
      if (key === "/api/global-proposals") return { data: undefined, error: new Error("proposals down") };
      return { data: undefined, error: undefined };
    });
    const { container } = render(<TransactionsPanel />);
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    expect(screen.getByText("0xaaa111")).toBeInTheDocument();
  });

  it("names the failure when only proposals were asked for and they failed", () => {
    useSWR.mockImplementation((key: string) => {
      if (key === "/api/global-proposals") return { data: undefined, error: new Error("proposals down") };
      return { data: undefined, error: undefined };
    });
    render(<TransactionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /awaiting signatures/i }));
    expect(screen.getByText(/proposals down/)).toBeInTheDocument();
  });

  it("says the filter only covers the entries loaded so far", () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);
    fireEvent.change(screen.getByLabelText("Filter by account ID"), { target: { value: "0xnothere" } });
    expect(screen.getByText(/among the 1 loaded so far/i)).toBeInTheDocument();
  });

  // Same controls as Accounts: sort by header, export what is shown, and the
  // next page arrives by scrolling. Sorted on Activity rather than Date, since
  // the feed already arrives newest first and a date sort would look the same.
  it("cycles a column through descending, ascending, then back to feed order", () => {
    const older = { ...delta("0xold", 1), category: "note_creation", statusTimestamp: "2026-01-01T00:00:00Z" };
    const newer = { ...delta("0xnew", 2), category: "asset_transfer", statusTimestamp: "2026-02-01T00:00:00Z" };
    mockFeeds([older, newer]);
    const { container } = render(<TransactionsPanel />);
    const ids = () => [...container.querySelectorAll("tbody tr")].map((r) => r.textContent?.slice(0, 5));
    expect(ids()).toEqual(["0xnew", "0xold"]);
    const header = screen.getByRole("button", { name: /^activity/i });
    const th = header.closest("th");
    expect(th).toHaveAttribute("aria-sort", "none");

    fireEvent.click(header); // "Note Created" before "Asset Transfer"
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(ids()).toEqual(["0xold", "0xnew"]);
    fireEvent.click(header);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(ids()).toEqual(["0xnew", "0xold"]);
    fireEvent.click(header);
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(ids()).toEqual(["0xnew", "0xold"]);
  });

  it("disables export when the filter leaves no rows", () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);
    const button = screen.getByRole("button", { name: /export csv/i });
    expect(button).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Filter by account ID"), { target: { value: "0xnothere" } });
    expect(button).toBeDisabled();
  });

  it("says how deep the table goes while there is more to page in", () => {
    mockFeeds([delta("0xaaa111", 1)], [], true, "page2");
    render(<TransactionsPanel />);
    expect(screen.getByText(/Showing the latest 1/)).toBeInTheDocument();
  });

  // The two aggregate keys used to be refreshed with a `fetch(...?refresh=1)`
  // ahead of the revalidation, because `refresh=1` told the route to re-walk
  // the account list and a plain revalidation would have been served the route
  // cache's copy. Neither the walk nor that cache exists now, so all four keys
  // go through the same `mutate`.
  it("refreshes the feeds and the strip on demand", async () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(vi.mocked(mutate)).toHaveBeenCalled());

    const revalidated = vi.mocked(mutate).mock.calls.map((c) => String(c[0]));
    expect(revalidated).toContain("/api/global-deltas");
    expect(revalidated).toContain("/api/global-proposals");
    expect(revalidated).toContain("/api/accounts/stats");
    expect(revalidated).toContain("/api/accounts/asset-totals");
  });
});
