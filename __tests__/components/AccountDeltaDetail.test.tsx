import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountDeltaDetail } from "@/components/accounts/AccountDeltaDetail";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ back: vi.fn() })) }));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const detail = (overrides: Record<string, unknown> = {}) => ({
  nonce: 7,
  status: "canonical",
  statusTimestamp: new Date("2026-09-10T09:00:00Z").toISOString(),
  prevCommitment: "0xprev",
  newCommitment: "0xnew",
  accountId: "0xabc123",
  category: "custom",
  inputNotes: [],
  outputNotes: [],
  vaultChanges: [],
  storageChanges: [],
  decodeWarnings: [],
  ...overrides,
});

function mockDetail(overrides: Record<string, unknown> = {}) {
  useSWR.mockImplementation(() => ({ data: detail(overrides), error: undefined, mutate: vi.fn() }));
}

beforeEach(() => vi.clearAllMocks());

/**
 * Guardian client 0.17.0 added the two P2IDE block heights (issue #366) and
 * per-note onchain visibility, alongside P2ID visibility from 0.16.2 (issue
 * #322). No Guardian in the fleet populates any of the three as of 2026-09-10,
 * so the absent case is what production renders and is the one that matters.
 */
describe("AccountDeltaDetail P2IDE and visibility fields", () => {
  it("shows the recall and timelock heights a P2IDE proposal carries", () => {
    mockDetail({
      proposal: {
        proposalType: "recallable_send",
        reclaimHeight: 1234567,
        timelockHeight: 1200000,
        noteType: "private",
      },
    });
    render(<AccountDeltaDetail accountId="0xabc123" nonce={7} />);
    expect(screen.getByText("Recallable from block")).toBeInTheDocument();
    expect(screen.getByText((1234567).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("Unlocks at block")).toBeInTheDocument();
    expect(screen.getByText((1200000).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("Note visibility")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
  });

  // What every delta on the fleet looks like today: the rows must not appear,
  // and must not render as "undefined" or an empty label.
  it("omits all three rows when the Guardian sends none of them", () => {
    mockDetail({ proposal: { proposalType: "recallable_send", requiredSignatures: 1 } });
    render(<AccountDeltaDetail accountId="0xabc123" nonce={7} />);
    expect(screen.queryByText("Recallable from block")).toBeNull();
    expect(screen.queryByText("Unlocks at block")).toBeNull();
    expect(screen.queryByText("Note visibility")).toBeNull();
    expect(screen.getByText("Signatures required")).toBeInTheDocument();
  });

  // A timelock with no recall, and block zero, which `!== undefined` keeps and a
  // truthiness check would drop.
  it("shows a height of zero rather than treating it as absent", () => {
    mockDetail({ proposal: { proposalType: "recallable_send", timelockHeight: 0 } });
    render(<AccountDeltaDetail accountId="0xabc123" nonce={7} />);
    expect(screen.getByText("Unlocks at block")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Recallable from block")).toBeNull();
  });

  it("badges a note's onchain visibility next to its tag", () => {
    mockDetail({
      outputNotes: [
        { noteId: "0xnote1", tag: "p2ide", noteType: "public", assets: [] },
        { noteId: "0xnote2", tag: "p2id", assets: [] },
      ],
    });
    render(<AccountDeltaDetail accountId="0xabc123" nonce={7} />);
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("P2ID with expiry")).toBeInTheDocument();
    // The second note carries no visibility, so it gets a tag badge and nothing else.
    expect(screen.getByText("P2ID (standard payment)")).toBeInTheDocument();
    expect(screen.queryByText("private")).toBeNull();
  });
});
