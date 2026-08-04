import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountDetail } from "@/components/accounts/AccountDetail";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const account = (overrides: Record<string, unknown> = {}) => ({
  accountId: "0xabc123",
  stateStatus: "available",
  authScheme: "ecdsa",
  authorizedSignerCount: 2,
  authorizedSignerIds: ["0xsigner1", "0xsigner2"],
  hasPendingCandidate: false,
  currentCommitment: "0xcommit",
  pausedAt: null,
  pausedReason: null,
  releasedAt: null,
  createdAt: new Date("2026-01-01").toISOString(),
  updatedAt: new Date("2026-01-02").toISOString(),
  ...overrides,
});

function mockAccount(overrides: Record<string, unknown> = {}, snapshot?: unknown) {
  useSWR.mockImplementation((key: string) => {
    if (key?.includes("snapshot")) return { data: snapshot, error: undefined, mutate: vi.fn() };
    if (key?.startsWith("/api/accounts/")) return { data: account(overrides), error: undefined, mutate: vi.fn() };
    return { data: undefined, error: undefined, mutate: vi.fn() };
  });
}

beforeEach(() => vi.clearAllMocks());

// "Released" appears both as the status badge and as a row label, so assert on
// the badge by its colour class rather than by text.
const badge = (container: HTMLElement, cls: string) => container.querySelector(`.${cls}`);

describe("AccountDetail", () => {
  it("shows Active for a normal account", () => {
    mockAccount();
    const { container } = render(<AccountDetail accountId="0xabc123" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(badge(container, "bg-state-released")).toBeNull();
  });

  it("shows the released badge and the switch date", () => {
    mockAccount({ releasedAt: new Date("2026-03-04T05:06:07Z").toISOString() });
    const { container } = render(<AccountDetail accountId="0xabc123" />);
    expect(badge(container, "bg-state-released")).toHaveTextContent("Released");
    expect(screen.getByText(/switched to another guardian/i)).toBeInTheDocument();
  });

  // Released is terminal and its remedy differs from pause's, so it has to win
  // the header even when the account also carries a pause.
  it("prefers released over frozen in the header", () => {
    mockAccount({
      releasedAt: new Date("2026-03-04T05:06:07Z").toISOString(),
      pausedAt: new Date("2026-02-01T00:00:00Z").toISOString(),
      pausedReason: "incident",
    });
    const { container } = render(<AccountDetail accountId="0xabc123" />);
    expect(badge(container, "bg-state-released")).toHaveTextContent("Released");
    expect(badge(container, "bg-state-frozen")).toBeNull();
    // the pause row still renders, so neither the reason nor the time is lost
    expect(screen.getByText(/incident/)).toBeInTheDocument();
  });

  it("shows skeletons while loading and the server message on failure", () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined, mutate: vi.fn() });
    const { container, unmount } = render(<AccountDetail accountId="0xabc123" />);
    expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    unmount();

    useSWR.mockReturnValue({ data: undefined, error: new Error("Guardian offline"), mutate: vi.fn() });
    render(<AccountDetail accountId="0xabc123" />);
    expect(screen.getByText("Guardian offline")).toBeInTheDocument();
  });

  it("renders signers, technical details on expand, and the vault", () => {
    mockAccount({ stateCreatedAt: new Date("2026-01-01").toISOString(), stateUpdatedAt: new Date("2026-01-02").toISOString() }, {
      commitment: "0xcommit",
      updatedAt: new Date("2026-01-02").toISOString(),
      hasPendingCandidate: true,
      vault: { fungible: [{ faucetId: "0xfaucet", amount: "1500" }], nonFungible: [{ faucetId: "0xnft", vaultKey: "0xkey" }] },
    });
    render(<AccountDetail accountId="0xabc123" />);

    expect(screen.getByText("Authorized signers")).toBeInTheDocument();
    expect(screen.getByText(/state update is in progress/i)).toBeInTheDocument();
    expect(screen.getByText("1,500 units")).toBeInTheDocument();
    expect(screen.getByText("Non-fungible assets")).toBeInTheDocument();

    expect(screen.queryByText("Commitment")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("Commitment")).toBeInTheDocument();
    expect(screen.getByText("State created")).toBeInTheDocument();
  });

  it("says so when the vault is empty", () => {
    mockAccount({}, { commitment: "0xc", updatedAt: new Date().toISOString(), hasPendingCandidate: false, vault: { fungible: [], nonFungible: [] } });
    render(<AccountDetail accountId="0xabc123" />);
    expect(screen.getByText(/no assets in vault/i)).toBeInTheDocument();
  });

  it("requires a reason before a freeze can be submitted, and surfaces server failures", async () => {
    mockAccount();
    const { container } = render(<AccountDetail accountId="0xabc123" />);
    fireEvent.click(screen.getByText("Freeze Account"));
    expect(screen.getByText("Freeze Account", { selector: "h2" })).toBeInTheDocument();

    // the modal's submit carries the same label as the trigger; pick it by its style
    const submit = container.querySelector("button.bg-state-error") as HTMLButtonElement;
    expect(submit).toBeDisabled(); // no reason typed yet

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: "Guardian refused" }), { status: 503 }));
    fireEvent.change(screen.getByPlaceholderText(/suspicious activity/i), { target: { value: "incident 42" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText("Guardian refused")).toBeInTheDocument());
    fetchSpy.mockRestore();
  });

  it("offers unfreeze instead of freeze when the account is frozen", () => {
    mockAccount({ pausedAt: new Date().toISOString(), pausedReason: "incident" });
    render(<AccountDetail accountId="0xabc123" />);
    expect(screen.getByText("Unfreeze Account")).toBeInTheDocument();
    expect(screen.queryByText("Freeze Account")).not.toBeInTheDocument();
  });
});
