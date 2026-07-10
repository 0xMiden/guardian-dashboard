import { describe, it, expect, vi, afterEach } from "vitest";
import { cn, fetcher, FetchError } from "@/lib/utils";

describe("fetcher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(fetcher("/api/x")).resolves.toEqual({ items: [] });
  });

  it("throws the server's error message with the status attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 503 })));
    const err = await fetcher("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.message).toBe("rate limited");
    expect(err.status).toBe(503);
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 500 })));
    const err = await fetcher("/api/x").catch((e) => e);
    expect(err.message).toBe("Request failed (500)");
    expect(err.status).toBe(500);
  });
});

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("resolves tailwind conflicts — last one wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional falsy values", () => {
    expect(cn("foo", false && "bar", undefined, null, "baz")).toBe("foo baz");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });
});
