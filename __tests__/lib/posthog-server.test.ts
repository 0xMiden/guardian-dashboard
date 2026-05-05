import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(function (this: { capture: ReturnType<typeof vi.fn> }) {
    this.capture = vi.fn();
  }),
}));

beforeEach(() => {
  vi.resetModules();
});

describe("getPostHogClient", () => {
  it("returns a PostHog instance", async () => {
    const { getPostHogClient } = await import("@/lib/posthog-server");
    const client = getPostHogClient();
    expect(client).toBeDefined();
    expect(typeof client.capture).toBe("function");
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    const { getPostHogClient } = await import("@/lib/posthog-server");
    expect(getPostHogClient()).toBe(getPostHogClient());
  });
});
