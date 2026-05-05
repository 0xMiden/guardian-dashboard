import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeartbeatCard } from "@/components/overview/HeartbeatCard";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

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
});
