import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssetsCard } from "@/components/overview/AssetsCard";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const mockData = (data: unknown) => useSWR.mockReturnValue({ data, error: undefined });

/** The options object this render passed to useSWR. */
const optionsFromCall = (i: number) => useSWR.mock.calls[i][2] as { refreshInterval: unknown };

beforeEach(() => vi.clearAllMocks());

describe("AssetsCard", () => {
  it("shows the total once it is published", () => {
    mockData({ usd: 3911871.94 });
    render(<AssetsCard />);
    expect(screen.getByText("$3,911,871.94")).toBeInTheDocument();
  });

  // The Guardian reports its own coverage (`covered`/`eligible`), so the card
  // can say how far the server's pass got instead of only that it is waiting.
  it("counts out loud while the Guardian's coverage is incomplete", () => {
    mockData({ usd: null, warming: true, done: 358, total: 995 });
    render(<AssetsCard />);
    expect(screen.getByText(/Calculating/)).toBeInTheDocument();
    expect(screen.getByText("358 of 995")).toBeInTheDocument();
  });

  // A 0.17.0 Guardian has no cross-account aggregate at all. Measured
  // 2026-10-06, that was still openzeppelin (23,303 accounts) and koda. It must
  // not look like the offline case below, which is what a bare dash says.
  it("names the version it needs on a Guardian older than 0.18.0", () => {
    mockData({ unsupported: true });
    render(<AssetsCard />);
    expect(screen.getByText("Needs Guardian 0.18.0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  // Priced like the Miden wallet: a test mint has no market. On 2026-10-07
  // that was every faucet on the fleet. It is a different claim from "the
  // Guardian holds nothing", which is what a $0.00 would say.
  it("says so when holdings exist but nothing prices them", () => {
    mockData({ usd: null, priced: 0, unpriced: 104 });
    render(<AssetsCard />);
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.getByTitle(/104 token/)).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("shows a genuine zero for a fleet holding nothing at all", () => {
    mockData({ usd: 0, priced: 0, unpriced: 0 });
    render(<AssetsCard />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("shows a dash rather than a zero when the Guardian did not answer", () => {
    useSWR.mockReturnValue({ data: undefined, error: new Error("Guardian offline") });
    render(<AssetsCard />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

/**
 * Regression guard for b9c9bd9, which this card shipped twice. SWR keeps
 * `refreshInterval` in its polling effect's dependencies, so an inline function
 * gets a new identity every render, resets the timer, and a card re-rendering
 * faster than the interval never polls. A plain number cannot.
 */
describe("AssetsCard poll scheduling", () => {
  it("polls on a plain number, not a function of the last answer", () => {
    mockData({ usd: null, warming: true, done: 10, total: 100 });
    render(<AssetsCard />);
    expect(optionsFromCall(0).refreshInterval).toBe(60_000);
  });
});

describe("AssetsCard expander", () => {
  it("expands into the priced and unpriced token counts", () => {
    mockData({ usd: 2.32, priced: 1, unpriced: 3 });
    render(<AssetsCard />);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Priced tokens")).toBeInTheDocument();
    expect(screen.getByText("Unpriced tokens")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
