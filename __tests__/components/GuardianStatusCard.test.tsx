import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GuardianStatusCard } from "@/components/overview/GuardianStatusCard";

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // Stands in for the drawn line, so a test can tell whether the sparkline was
  // rendered at all without measuring anything in jsdom.
  Line: () => <div data-testid="latency-chart" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}));

const useSWR = (await import("swr")).default as ReturnType<typeof vi.fn>;

// One clock reading for the whole module. `checkedAt` and `startedAt` used to
// call the clock separately, and the card derives uptime as the gap between
// them. A millisecond ticking over between the two lines made that gap
// 3,599,999ms, which floors to 3,599s and renders "59m" rather than "1h 0m",
// failing the uptime test about one run in five.
const NOW = Date.now();
const healthUp = { status: "up", latencyMs: 42, checkedAt: new Date(NOW).toISOString() };
const healthDown = { status: "down", latencyMs: 999, checkedAt: new Date(NOW).toISOString() };
const overview = {
  environment: "testnet",
  build: { version: "0.15.0", gitCommit: "abc1234", startedAt: new Date(NOW - 3600_000).toISOString(), profile: "release" },
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
  sessionStorage.clear();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.assign(document, { execCommand: vi.fn().mockReturnValue(true) });
});

const SAMPLES_KEY = `guardian:latency:${opInfo.url}`;

describe("GuardianStatusCard", () => {
  it("shows skeleton while health is loading", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { container } = render(<GuardianStatusCard />);
    expect(container.querySelector("[data-slot='skeleton'], .animate-pulse")).toBeTruthy();
  });

  it("shows Online badge when Guardian is up", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows Offline badge when Guardian is down", () => {
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

  // Uptime used to be state set from SWR's onSuccess, which does not fire when
  // the data comes from the cache. Switching tabs and coming straight back left
  // the row reading "—" next to a "since ..." line that was clearly populated.
  it("shows uptime on a cache read, without waiting for a fetch", () => {
    mockSWR();
    render(<GuardianStatusCard />);
    expect(screen.getByText("1h 0m")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("shows no uptime when the Guardian reports no start time", () => {
    mockSWR({ overview: { build: { version: "0.15.0", gitCommit: "abc1234", startedAt: "", profile: "release" } } });
    render(<GuardianStatusCard />);
    expect(screen.queryByText("Uptime")).not.toBeInTheDocument();
  });

  // The latency sparkline used to be component state only, so every return to
  // Overview started from an empty chart and needed two polls (10s) to draw a
  // line at all.
  it("draws the sparkline from samples kept for this endpoint", () => {
    sessionStorage.setItem(SAMPLES_KEY, JSON.stringify([
      { t: Date.now() - 10_000, ms: 40 },
      { t: Date.now() - 5_000, ms: 44 },
    ]));
    mockSWR();
    const { container } = render(<GuardianStatusCard />);
    expect(container.querySelector("[data-testid='latency-chart']")).toBeTruthy();
  });

  it("ignores samples belonging to a different endpoint", () => {
    sessionStorage.setItem("guardian:latency:https://other.example.com", JSON.stringify([
      { t: Date.now() - 10_000, ms: 900 },
      { t: Date.now() - 5_000, ms: 950 },
    ]));
    mockSWR();
    const { container } = render(<GuardianStatusCard />);
    expect(container.querySelector("[data-testid='latency-chart']")).toBeFalsy();
  });

  it("discards samples too old to describe current latency", () => {
    sessionStorage.setItem(SAMPLES_KEY, JSON.stringify([
      { t: Date.now() - 3600_000, ms: 40 },
      { t: Date.now() - 3500_000, ms: 44 },
    ]));
    mockSWR();
    const { container } = render(<GuardianStatusCard />);
    expect(container.querySelector("[data-testid='latency-chart']")).toBeFalsy();
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
