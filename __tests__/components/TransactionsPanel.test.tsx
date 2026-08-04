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

function mockFeeds(deltas: unknown[], proposals: unknown[] = [], withStats = true) {
  useSWR.mockImplementation((key: string) => {
    if (typeof key === "string" && key.startsWith("/api/global-deltas")) {
      return { data: { items: deltas, nextCursor: null }, error: undefined };
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
    expect(screen.getByText("Total")).toBeInTheDocument();
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

  it("says the filter only covers the entries loaded so far", () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);
    fireEvent.change(screen.getByLabelText("Filter by account ID"), { target: { value: "0xnothere" } });
    expect(screen.getByText(/in the entries loaded so far/i)).toBeInTheDocument();
  });

  it("refreshes the feeds and the strip on demand", async () => {
    mockFeeds([delta("0xaaa111", 1)]);
    render(<TransactionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const revalidated = vi.mocked(mutate).mock.calls.map((c) => String(c[0]));
    expect(revalidated).toContain("/api/global-deltas");
    expect(revalidated).toContain("/api/global-proposals");

    const refreshed = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(refreshed).toContain("/api/accounts/stats?refresh=1");
    expect(refreshed).toContain("/api/accounts/asset-totals?refresh=1");
  });
});
