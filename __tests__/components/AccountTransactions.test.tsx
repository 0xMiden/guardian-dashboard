import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountTransactions } from "@/components/accounts/AccountTransactions";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })) }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const delta = (nonce: number) => ({
  nonce, status: "canonical", category: "transfer",
  statusTimestamp: new Date().toISOString(), assets: undefined, counterparty: undefined,
});

function mockFeeds(deltas: { data?: unknown; error?: Error }, proposals: { data?: unknown; error?: Error }) {
  useSWR.mockImplementation((key: string) => {
    if (key.endsWith("/deltas")) return { data: deltas.data, error: deltas.error };
    if (key.endsWith("/proposals")) return { data: proposals.data, error: proposals.error };
    return { data: undefined, error: undefined };
  });
}

beforeEach(() => vi.clearAllMocks());

// A failed proposals fetch used to count as "still loading", so the skeleton
// never cleared and the deltas that had arrived were never shown.
describe("AccountTransactions when a feed fails", () => {
  it("still lists the deltas when the proposals feed fails", () => {
    mockFeeds({ data: { items: [delta(3)], nextCursor: null } }, { error: new Error("proposals down") });
    const { container } = render(<AccountTransactions accountId="0xabc123" />);
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("names the failure when the deltas feed fails", () => {
    mockFeeds({ error: new Error("Guardian refused") }, { error: new Error("proposals down") });
    const { container } = render(<AccountTransactions accountId="0xabc123" />);
    expect(container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    expect(screen.getByText(/Guardian refused/)).toBeInTheDocument();
  });
});
