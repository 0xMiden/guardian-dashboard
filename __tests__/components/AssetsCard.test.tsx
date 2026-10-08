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
    mockData({ usd7d: 3911871.94, computedAt: "2026-08-04T12:00:00Z" });
    render(<AssetsCard />);
    expect(screen.getByText("$3,911,871.94")).toBeInTheDocument();
  });

  // The Guardian reports its own coverage (`covered`/`eligible`), so the card
  // can say how far the server's pass got instead of only that it is waiting.
  it("counts out loud while the Guardian's coverage is incomplete", () => {
    mockData({ usd7d: null, warming: true, done: 358, total: 995 });
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
    mockData({ usd7d: null, computedAt: "2026-10-07T12:00:00Z", priced: 0, unpriced: 104 });
    render(<AssetsCard />);
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.getByTitle(/104 token/)).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("shows a genuine zero for a fleet holding nothing at all", () => {
    mockData({ usd7d: 0, computedAt: "2026-10-07T12:00:00Z", priced: 0, unpriced: 0 });
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
 * Regression guard for b9c9bd9, which this card shipped twice.
 *
 * SWR keeps `refreshInterval` in its polling effect's dependency array and the
 * cleanup calls `clearTimeout`, so an inline arrow gives a new identity every
 * render, tears the timer down and schedules a fresh FULL-length one. A card
 * re-rendering more often than the interval then never polls at all, which was
 * the "stuck on Calculating… until I visit another tab" report.
 *
 * The tiered interval that made this trap reachable is gone: it polled three
 * times faster while the walk was incomplete, to keep a walk moving that only
 * advanced while something asked. The Guardian now refreshes its own aggregate
 * on a fixed cadence whether we poll or not, so one plain number does.
 */
describe("AssetsCard poll scheduling", () => {
  it("passes a referentially stable refreshInterval across re-renders", () => {
    mockData({ usd7d: null, warming: true, done: 10, total: 100 });
    const { rerender } = render(<AssetsCard />);
    rerender(<AssetsCard />);
    rerender(<AssetsCard />);

    expect(useSWR.mock.calls.length).toBeGreaterThanOrEqual(3);
    const first = optionsFromCall(0).refreshInterval;
    for (let i = 1; i < useSWR.mock.calls.length; i++) {
      expect(optionsFromCall(i).refreshInterval).toBe(first);
    }
  });

  // Stronger than the stability check above: a literal cannot acquire a new
  // identity per render in the first place, so the trap is unreachable rather
  // than merely avoided.
  it("polls on a plain number, not a function of the last answer", () => {
    mockData({ usd7d: null, warming: true, done: 10, total: 100 });
    render(<AssetsCard />);
    expect(optionsFromCall(0).refreshInterval).toBe(60_000);
  });
});

describe("AssetsCard expander", () => {
  it("expands into the priced and unpriced token counts", () => {
    mockData({ usd7d: 2.32, computedAt: "2026-10-08T10:00:00Z", priced: 1, unpriced: 3 });
    render(<AssetsCard />);
    expect(screen.getByText(/held by accounts updated in the last 7d/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Priced tokens")).toBeInTheDocument();
    expect(screen.getByText("Unpriced tokens")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
