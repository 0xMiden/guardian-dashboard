import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountsPanel, ACCOUNTS_KEY } from "@/components/accounts/AccountsPanel";

vi.mock("swr", () => ({ default: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

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
