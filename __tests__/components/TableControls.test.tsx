import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { AccountsPanel, ACCOUNTS_KEY } from "@/components/accounts/AccountsPanel";
import { LoadMoreSentinel, usePaging, sortRows } from "@/components/ui/TableControls";

vi.mock("swr", () => ({ default: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const row = {
  accountId: "0xabc123",
  stateStatus: "available",
  authScheme: "falcon",
  authorizedSignerCount: 3,
  hasPendingCandidate: false,
  pausedAt: null,
  pausedReason: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useSWR.mockImplementation((key: string) =>
    key === ACCOUNTS_KEY ? { data: { items: [row], nextCursor: null }, error: undefined } : { data: undefined, error: undefined }
  );
});

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /columns/i }));

describe("accounts table controls", () => {
  it("drops a column from the header and the body together", () => {
    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll("thead th")).toHaveLength(9);
    expect(container.querySelectorAll("tbody tr td")).toHaveLength(9);

    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Created" }));

    expect(container.querySelectorAll("thead th")).toHaveLength(8);
    // The colgroup has to shrink with them, or every remaining column is sized
    // by the wrong <col>.
    expect(container.querySelectorAll("colgroup col")).toHaveLength(8);
    expect(container.querySelectorAll("tbody tr td")).toHaveLength(8);
  });

  it("does not offer the row number or the account id for hiding", () => {
    render(<AccountsPanel />);
    openMenu();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Account ID" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(7);
  });

  it("remembers the choice for the next visit", () => {
    const first = render(<AccountsPanel />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Pending" }));
    first.unmount();

    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll("thead th")).toHaveLength(8);
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  // A stored key for a column that no longer exists must not count against the
  // visible tally, or the button reads "(6)" while nine columns are on screen.
  it("ignores a stored column that the table no longer has", () => {
    localStorage.setItem("guardian:table:accounts", JSON.stringify({ density: "comfortable", hidden: ["retired"] }));
    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll("thead th")).toHaveLength(9);
  });

  it("tightens the rows on the density toggle and remembers it", () => {
    const first = render(<AccountsPanel />);
    expect(first.container.querySelector("tbody td")!.className).toContain("py-3");

    fireEvent.click(screen.getByRole("button", { name: /switch to compact rows/i }));
    expect(first.container.querySelector("tbody td")!.className).toContain("py-1.5");
    // The header has to move with the body, or it detaches from its column.
    expect(first.container.querySelector("thead th")!.className).toContain("py-1.5");
    first.unmount();

    const { container } = render(<AccountsPanel />);
    expect(container.querySelector("tbody td")!.className).toContain("py-1.5");
  });

  it("survives storage it cannot parse rather than blanking the table", () => {
    localStorage.setItem("guardian:table:accounts", "not json");
    const { container } = render(<AccountsPanel />);
    expect(container.querySelectorAll("thead th")).toHaveLength(9);
  });
});

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const { TransactionsPanel } = await import("@/components/transactions/TransactionsPanel");

const delta = (accountId: string, nonce: number) => ({
  accountId, nonce, status: "canonical", category: "transfer",
  statusTimestamp: "2026-07-29T10:00:00.000Z", assets: undefined, counterparty: undefined,
});

function mockActivity() {
  useSWR.mockImplementation((key: string) => {
    if (typeof key === "string" && key.startsWith("/api/global-deltas")) {
      return { data: { items: [delta("0xabc123", 1)], nextCursor: null }, error: undefined };
    }
    if (key === "/api/global-proposals") return { data: { items: [], nextCursor: null }, error: undefined };
    return { data: undefined, error: undefined };
  });
}

describe("activity table controls", () => {
  it("drops a column from the header, the colgroup and the body together", () => {
    mockActivity();
    const { container } = render(<TransactionsPanel />);
    expect(container.querySelectorAll("thead th")).toHaveLength(6);

    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Amount" }));

    expect(container.querySelectorAll("thead th")).toHaveLength(5);
    expect(container.querySelectorAll("colgroup col")).toHaveLength(5);
    expect(container.querySelectorAll("tbody tr td")).toHaveLength(5);
  });

  it("keeps the account column, which is what identifies a row", () => {
    mockActivity();
    render(<TransactionsPanel />);
    openMenu();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(5);
  });

  it("tightens the rows on the density toggle", () => {
    mockActivity();
    const { container } = render(<TransactionsPanel />);
    expect(container.querySelector("tbody td")!.className).toContain("py-3");
    fireEvent.click(screen.getByRole("button", { name: /switch to compact rows/i }));
    expect(container.querySelector("tbody td")!.className).toContain("py-1.5");
  });

  // Two tables with different columns cannot share one stored preference, or
  // hiding Amount on Activity would hide whatever sits in that slot on Accounts.
  it("keeps its preferences separate from the accounts table", () => {
    mockActivity();
    const activity = render(<TransactionsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch to compact rows/i }));
    activity.unmount();

    useSWR.mockImplementation((key: string) =>
      key === ACCOUNTS_KEY ? { data: { items: [row], nextCursor: null }, error: undefined } : { data: undefined, error: undefined }
    );
    const { container } = render(<AccountsPanel />);
    expect(container.querySelector("tbody td")!.className).toContain("py-3");
    expect(localStorage.getItem("guardian:table:transactions")).toContain("compact");
  });
});

const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];

// Fires at once on observe, as a browser does for an element already in view.
const armObserver = () => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) { observers.push(this); }
    observe() { this.cb([{ isIntersecting: true }]); }
  });
};

const sentinel = (over: Partial<Parameters<typeof LoadMoreSentinel>[0]> = {}, loadMore = vi.fn()) =>
  <LoadMoreSentinel hasMore loadingMore={false} failed={false} loadMore={loadMore} {...over} />;

describe("LoadMoreSentinel", () => {
  beforeEach(armObserver);
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the next page when it scrolls into view", () => {
    const loadMore = vi.fn();
    render(sentinel({}, loadMore));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  // The observer fires on a visibility change only. A page whose rows all fell
  // to a client-side filter leaves the sentinel where it was, on screen, so
  // without a re-arm it would never ask for the page after that one. And no
  // observer may exist while a page loads, or the same cursor is asked twice.
  it("asks again after a page lands while it is still on screen, once", () => {
    const loadMore = vi.fn();
    const { rerender } = render(sentinel({}, loadMore));
    rerender(sentinel({ loadingMore: true }, loadMore));
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(loadMore).toHaveBeenCalledTimes(1);
    rerender(sentinel({}, loadMore));
    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  // A failed page must not be asked for again by itself: with the observer
  // rebuilt after each failure, a Guardian answering 429 would be hit in a loop.
  it("stops asking after a failure and offers a retry instead", () => {
    const loadMore = vi.fn();
    render(sentinel({ failed: true }, loadMore));
    expect(loadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("is absent once there is nothing more to load", () => {
    const { container } = render(sentinel({ hasMore: false }));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("usePaging", () => {
  const page = (items: string[], nextCursor: string | null) => ({ items, nextCursor });
  const id = (s: string) => s;

  it("lists every page loaded so far and stops at the last cursor", async () => {
    const fetchPage = vi.fn(async (cursor: string) => (cursor === "p2" ? page(["b"], "p3") : page(["c"], null)));
    const { result } = renderHook(() => usePaging("k", page(["a"], "p2"), fetchPage, id));
    expect(result.current.hasMore).toBe(true);
    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());
    expect(result.current.items).toEqual(["a", "b", "c"]);
    expect(result.current.hasMore).toBe(false);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["p2", "p3"]);
  });

  it("keeps the cursor when a fetch fails, flags it, and retries the same page", async () => {
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(page(["b"], null));
    const { result } = renderHook(() => usePaging("k", page(["a"], "p2"), fetchPage, id));
    await act(() => result.current.loadMore());
    expect(result.current.failed).toBe(true);
    expect(result.current.hasMore).toBe(true);
    await act(() => result.current.loadMore());
    expect(result.current.failed).toBe(false);
    expect(result.current.items).toEqual(["a", "b"]);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["p2", "p2"]);
  });

  // A filter change resets the list while a page for the old filter may still
  // be on its way. That page must not land under the new filter.
  it("drops a page that was in flight when reset was called", async () => {
    let resolve!: (p: { items: string[]; nextCursor: string | null }) => void;
    const fetchPage = vi.fn(() => new Promise<{ items: string[]; nextCursor: string | null }>((r) => { resolve = r; }));
    const { result } = renderHook(() => usePaging("k", page(["a"], "p2"), fetchPage, id));
    const inFlight = act(() => result.current.loadMore());
    act(() => result.current.reset());
    resolve(page(["stale"], "p3"));
    await inFlight;
    expect(result.current.items).toEqual(["a"]);
    expect(result.current.loadingMore).toBe(false);
  });

  it("starts over when the key changes, dropping a page in flight for the old one", async () => {
    let resolve!: (p: { items: string[]; nextCursor: string | null }) => void;
    const fetchPage = vi.fn(() => new Promise<{ items: string[]; nextCursor: string | null }>((r) => { resolve = r; }));
    const { result, rerender } = renderHook(
      ({ key, first }) => usePaging(key, first, fetchPage, id),
      { initialProps: { key: "all", first: page(["a"], "p2") } },
    );
    const inFlight = act(() => result.current.loadMore());
    rerender({ key: "frozen", first: page(["f"], null) });
    resolve(page(["stale"], "p3"));
    await inFlight;
    expect(result.current.items).toEqual(["f"]);
    expect(result.current.hasMore).toBe(false);
  });

  // SWR polls the first page while the tail continues from where it was, so a
  // row that moved between them would otherwise render twice, with one key.
  it("lists a row once when the polled first page and the tail both hold it", async () => {
    const fetchPage = vi.fn(async () => page(["b", "c"], null));
    const { result, rerender } = renderHook(
      ({ first }) => usePaging("k", first, fetchPage, id),
      { initialProps: { first: page(["a"], "p2") } },
    );
    await act(() => result.current.loadMore());
    rerender({ first: page(["b", "a"], "p2") });
    expect(result.current.items).toEqual(["b", "a", "c"]);
  });

  it("has nothing more while the first page is still loading", () => {
    const { result } = renderHook(() => usePaging("k", undefined, vi.fn(), id));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});

describe("sortRows", () => {
  // An unknown value must not read as the smallest one.
  it("puts null last in both directions", () => {
    const rows = [{ v: 1 }, { v: null }, { v: 3 }];
    const value = (r: { v: number | null }) => r.v;
    expect(sortRows(rows, { key: "v", dir: "desc" }, value).map((r) => r.v)).toEqual([3, 1, null]);
    expect(sortRows(rows, { key: "v", dir: "asc" }, value).map((r) => r.v)).toEqual([1, 3, null]);
    expect(sortRows(rows, null, value)).toBe(rows);
  });
});
