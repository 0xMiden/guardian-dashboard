import { vi } from "vitest";
import "@testing-library/jest-dom";

// Required env vars
process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://us.i.posthog.com";
process.env.GUARDIAN_ENDPOINTS = JSON.stringify([
  {
    id: "testnet",
    label: "Guardian Testnet",
    url: "https://guardian.example.com",
    network: "MidenTestnet",
    commitment: "0xabc123",
    privateKey: "deadbeef",
  },
]);

// next/headers throws outside a request context — mock it globally
vi.mock("next/headers", () => ({
  headers: vi.fn(),
  cookies: vi.fn(),
}));

// posthog-js has no browser APIs in jsdom
vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    init: vi.fn(),
  },
}));

// recharts uses ResizeObserver which jsdom doesn't support
vi.mock("recharts", () => ({
  LineChart: () => null,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: () => null,
}));
