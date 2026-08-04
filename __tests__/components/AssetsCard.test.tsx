import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("counts out loud while the walk is still running", () => {
    mockData({ usd7d: null, warming: true, done: 358, total: 995 });
    render(<AssetsCard />);
    expect(screen.getByText(/Calculating/)).toBeInTheDocument();
    expect(screen.getByText("358 of 995")).toBeInTheDocument();
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
 * re-rendering more often than the interval then never polls at all, and the
 * asset walk only advances when something remounts it. That is exactly the
 * "stuck on Calculating… until I visit another tab" report.
 *
 * A comment asking future me to be careful was not enough, hence a test.
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

  it("asks more often while warming than once settled", () => {
    mockData({ usd7d: null, warming: true, done: 10, total: 100 });
    render(<AssetsCard />);
    const interval = optionsFromCall(0).refreshInterval as (d: unknown) => number;

    expect(typeof interval).toBe("function");
    const warming = interval({ warming: true });
    const settled = interval({ usd7d: 1 });
    expect(warming).toBeLessThan(settled);
    // Undefined is the first-mount case, before any answer has arrived.
    expect(interval(undefined)).toBe(settled);
  });
});
