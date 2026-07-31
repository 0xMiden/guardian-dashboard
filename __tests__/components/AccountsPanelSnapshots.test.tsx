import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// jsdom has no IntersectionObserver. This stub records what the panel observes
// so a test can decide which rows "become visible", which is the whole point of
// fetching asset totals lazily.
//
// Visibility is delivered to every live observer that actually watches the
// element, rather than to whichever one was constructed last. The panel is not
// the only thing observing: `next/link` runs its own observer per link, so a
// last-one-wins stub silently sent the panel's rows to a link's callback and the
// panel never learned a row had scrolled away.
const observed = new Set<Element>();
const instances = new Set<StubObserver>();

class StubObserver {
  private els = new Set<Element>();
  constructor(private cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
    instances.add(this);
  }
  observe(el: Element) { this.els.add(el); observed.add(el); }
  unobserve(el: Element) { this.els.delete(el); observed.delete(el); }
  disconnect() {
    for (const el of this.els) observed.delete(el);
    this.els.clear();
    instances.delete(this);
  }
  deliver(els: Element[], isIntersecting: boolean) {
    const mine = els.filter((el) => this.els.has(el));
    if (mine.length) this.cb(mine.map((target) => ({ isIntersecting, target })));
  }
}
vi.stubGlobal("IntersectionObserver", StubObserver);

const trigger = (els: Element[]) => instances.forEach((o) => o.deliver(els, true));
const hide = (els: Element[]) => instances.forEach((o) => o.deliver(els, false));

vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return { ...actual, default: vi.fn(), mutate: vi.fn(async () => undefined) };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const { AccountsPanel, ACCOUNTS_KEY } = await import("@/components/accounts/AccountsPanel");
const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const row = (id: string, updatedAt: string) => ({
  accountId: id, stateStatus: "available", authScheme: "ecdsa", authorizedSignerCount: 2,
  hasPendingCandidate: false, pausedAt: null, pausedReason: null,
  createdAt: "2026-07-01T00:00:00.000Z", updatedAt,
});

const A = row("0xa", "2026-07-29T10:00:00.000Z");
const B = row("0xb", "2026-07-29T11:00:00.000Z");

function mockRows(items: unknown[]) {
  useSWR.mockImplementation((key: string) =>
    key === ACCOUNTS_KEY ? { data: { items, nextCursor: null }, error: undefined } : { data: undefined, error: undefined }
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  observed.clear();
  instances.clear();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ "0xa": 1, "0xb": 2 }), { status: 200 })
  );
});
afterEach(() => fetchSpy.mockRestore());

// The panel coalesces newly-visible rows on a 150ms timer. Fake timers fight
// with waitFor here, so wait for real: the windows are short.
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const snapshotCalls = () =>
  fetchSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.includes("/api/accounts/snapshots"));

describe("AccountsPanel asset totals", () => {
  it("fetches nothing until a row is actually visible", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    await settle(500);
    expect(snapshotCalls()).toHaveLength(0);
  });

  it("fetches only the rows that came into view, with their versions", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    const visible = [...observed].filter((el) => (el as HTMLElement).dataset.accountId === "0xa");
    trigger(visible);
    await settle();

    const calls = snapshotCalls();
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0])).toContain("0xa@2026-07-29T10:00:00.000Z");
    expect(decodeURIComponent(calls[0])).not.toContain("0xb");
  });

  it("coalesces a burst of rows into one request", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    trigger([...observed]);
    await settle();

    const calls = snapshotCalls();
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0])).toContain("0xa@");
    expect(decodeURIComponent(calls[0])).toContain("0xb@");
  });

  it("does not refetch a row that has already been requested", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    const rows = [...observed];
    trigger(rows);
    await settle();
    expect(snapshotCalls()).toHaveLength(1);

    trigger(rows);
    await settle();
    expect(snapshotCalls()).toHaveLength(1);
  });

  it("manual refresh re-reads the aggregates and the rows on screen", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    trigger([...observed]);
    await settle();
    fetchSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await settle();

    const urls: string[] = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes("/api/accounts/stats?refresh=1"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/api/accounts/asset-totals?refresh=1"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/api/accounts/snapshots") && u.includes("refresh=1"))).toBe(true);
  });

  it("refresh asks only for the rows on screen, not every row ever loaded", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    // Both rows load their totals, then the user scrolls 0xa out of view.
    trigger([...observed]);
    await settle();
    hide([...observed].filter((el) => (el as HTMLElement).dataset.accountId === "0xa"));
    fetchSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await settle();

    const [call] = snapshotCalls();
    expect(decodeURIComponent(call)).toContain("0xb@");
    expect(decodeURIComponent(call)).not.toContain("0xa@");
  });

  // One global loading flag put a placeholder on every row without a value,
  // including rows nobody had asked for yet.
  it("marks only the rows with a request out as loading", async () => {
    mockRows([A, B]);
    let release: (r: Response) => void = () => {};
    fetchSpy.mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    const { container } = render(<AccountsPanel />);

    trigger([...observed].filter((el) => (el as HTMLElement).dataset.accountId === "0xa"));
    await settle();

    expect(container.querySelector("[data-testid='assets-loading-0xa']")).toBeTruthy();
    expect(container.querySelector("[data-testid='assets-loading-0xb']")).toBeFalsy();

    release(new Response(JSON.stringify({ "0xa": 5 }), { status: 200 }));
    await waitFor(() =>
      expect(container.querySelector("[data-testid='assets-loading-0xa']")).toBeFalsy(),
    );
  });

  // The observer used to be rebuilt from a hand-kept list of the state that
  // changes the rendered rows. The chip filter was on that list and the search
  // box was not, so a search left `visibleRef` holding rows that were no longer
  // mounted, and refresh went on spending node requests re-reading them.
  it("refresh does not re-read a row a search took off screen", async () => {
    mockRows([A, B]);
    render(<AccountsPanel />);
    trigger([...observed]);
    await settle();

    // Narrow to 0xb, then let the surviving row register itself.
    fireEvent.change(screen.getByPlaceholderText(/filter by account id/i), { target: { value: "0xb" } });
    await settle();
    trigger([...observed]);
    await settle();
    fetchSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await settle();

    const asked = decodeURIComponent(snapshotCalls().join("|"));
    expect(asked).not.toContain("0xa@");
  });

  it("leaves the column empty rather than showing a wrong number when the fetch fails", async () => {
    mockRows([A]);
    fetchSpy.mockResolvedValue(new Response("nope", { status: 503 }));
    render(<AccountsPanel />);
    trigger([...observed]);
    await settle();

    // the row still renders; the asset cell stays as the placeholder
    expect(screen.getByText("0xa")).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });
});

// The node defaults to 50 per page. Leaving it there meant 29 round trips to
// scroll a 1,418-account node, so the panel asks for the documented maximum and
// has to keep asking for it once it starts paging.
describe("AccountsPanel page size", () => {
  it("requests the node's maximum page rather than its default", () => {
    expect(ACCOUNTS_KEY).toBe("/api/accounts?limit=500");
  });

  it("keeps the page size when it pages in more rows", async () => {
    useSWR.mockImplementation((key: string) =>
      key === ACCOUNTS_KEY
        ? { data: { items: [A], nextCursor: "next-page" }, error: undefined }
        : { data: undefined, error: undefined });
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ items: [B], nextCursor: null }), { status: 200 }),
    );
    render(<AccountsPanel />);

    // The sentinel is the observed element that is not a row.
    trigger([...observed].filter((el) => !(el as HTMLElement).dataset.accountId));

    await waitFor(() => {
      const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(urls.some((u: string) => u.includes("limit=500") && u.includes("cursor=next-page"))).toBe(true);
    });
  });
});
