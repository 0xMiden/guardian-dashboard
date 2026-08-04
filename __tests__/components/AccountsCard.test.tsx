import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountsCard } from "@/components/overview/AccountsCard";

vi.mock("swr", () => ({ default: vi.fn() }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const mockData = (data: unknown) => useSWR.mockReturnValue({ data, error: undefined });

beforeEach(() => vi.clearAllMocks());

describe("AccountsCard", () => {
  it("shows the auth-method split when the Guardian computes it", () => {
    mockData({ totalAccounts: 6, falcon: 4, ecdsa: 2, evm: 0 });
    render(<AccountsCard />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Falcon")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("ECDSA")).toBeInTheDocument();
  });

  it("hides the EVM row when there are none", () => {
    mockData({ totalAccounts: 6, falcon: 4, ecdsa: 2, evm: 0 });
    render(<AccountsCard />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("EVM")).not.toBeInTheDocument();
  });

  // The Guardian stops computing this breakdown above a per-Guardian account threshold.
  // Rendering the empty result as zeros claimed the 1,573-account OZ Guardian had no
  // Falcon and no ECDSA accounts.
  it("says the breakdown is unavailable instead of showing zeros", () => {
    mockData({ totalAccounts: 1573, falcon: null, ecdsa: null, evm: null });
    render(<AccountsCard />);
    expect(screen.getByText("1,573")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/unavailable on this Guardian/i)).toBeInTheDocument();
    expect(screen.queryByText("Falcon")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
