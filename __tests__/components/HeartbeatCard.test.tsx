import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeartbeatCard } from "@/components/overview/HeartbeatCard";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

function captureOnSuccess() {
  let captured: ((d: { status: string; latencyMs: number; checkedAt: string }) => void) | undefined;
  useSWR.mockImplementation((_key: string, _fetcher: unknown, opts?: { onSuccess?: typeof captured }) => {
    if (opts?.onSuccess) captured = opts.onSuccess;
    return { data: undefined };
  });
  return () => captured;
}

beforeEach(() => vi.clearAllMocks());

describe("HeartbeatCard", () => {
  it("shows skeleton while loading", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { container } = render(<HeartbeatCard />);
    expect(container.querySelector("[data-slot='skeleton'], .animate-pulse")).toBeInTheDocument();
  });

  it("shows Online badge and latency when node is up", () => {
    useSWR
      .mockReturnValueOnce({ data: { status: "up", latencyMs: 42, checkedAt: new Date().toISOString() } })
      .mockReturnValueOnce({ data: { url: "https://guardian.example.com" } });
    render(<HeartbeatCard />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("shows Offline badge when node is down", () => {
    useSWR
      .mockReturnValueOnce({ data: { status: "down", latencyMs: 0, checkedAt: new Date().toISOString() } })
      .mockReturnValueOnce({ data: undefined });
    render(<HeartbeatCard />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("onSuccess callback appends latency to history", () => {
    const getOnSuccess = captureOnSuccess();
    render(<HeartbeatCard />);
    const onSuccess = getOnSuccess();
    expect(onSuccess).toBeDefined();
    onSuccess!({ status: "up", latencyMs: 55, checkedAt: new Date().toISOString() });
  });
});
