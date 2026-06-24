import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GuardianStatusCard } from "@/components/overview/GuardianStatusCard";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

const healthUp = { status: "up", latencyMs: 42, checkedAt: new Date().toISOString() };
const healthDown = { status: "down", latencyMs: 999, checkedAt: new Date().toISOString() };
const overview = {
  environment: "testnet",
  build: { version: "0.15.0", gitCommit: "abc1234", startedAt: new Date(Date.now() - 3600_000).toISOString(), profile: "release" },
};
const opInfo = { url: "https://guardian.example.com", network: "MidenTestnet", publicKey: "0xdeadbeef00112233" };

function mockSWR(overrides: Record<string, unknown> = {}) {
  useSWR.mockImplementation((key: string) => {
    if (key === "/api/health") return { data: overrides.health ?? healthUp };
    if (key === "/api/overview") return { data: overrides.overview ?? overview };
    if (key === "/api/operator-info") return { data: overrides.opInfo ?? opInfo };
    return { data: undefined };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.assign(document, { execCommand: vi.fn().mockReturnValue(true) });
});

describe("GuardianStatusCard", () => {
  it("shows skeleton while health is loading", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { container } = render(<GuardianStatusCard />);
    expect(container.querySelector("[data-slot='skeleton'], .animate-pulse")).toBeTruthy();
  });

  it("shows Online badge when node is up", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows Offline badge when node is down", () => {
    mockSWR({ health: healthDown });
    render(<GuardianStatusCard />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("shows latency in ms", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("renders endpoint URL without protocol", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("guardian.example.com")).toBeInTheDocument();
  });

  it("renders network badge", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("MidenTestnet")).toBeInTheDocument();
  });

  it("renders version from build info", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("0.15.0")).toBeInTheDocument();
  });

  it("hides details section by default", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.queryByText(/abc1234/)).not.toBeInTheDocument();
  });

  it("shows commit and public key after expanding details", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByTitle("0xdeadbeef00112233")).toBeInTheDocument();
  });

  it("collapses details again on second click", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    fireEvent.click(screen.getByText("Show details"));
    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.queryByText("abc1234")).not.toBeInTheDocument();
  });

  it("hides Show details when no commit and no public key", () => {
    mockSWR({
      overview: { build: { version: "0.15.0", gitCommit: "unknown", startedAt: new Date().toISOString(), profile: "release" } },
      opInfo: { ...opInfo, publicKey: null },
    });
    render(<GuardianStatusCard />);
    expect(screen.queryByText("Show details")).not.toBeInTheDocument();
  });

  it("copies public key to clipboard on click", async () => {
    mockSWR();
    render(<GuardianStatusCard />);
    fireEvent.click(screen.getByText("Show details"));
    const btn = screen.getByTitle("0xdeadbeef00112233");
    await act(async () => { fireEvent.click(btn); });
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});
