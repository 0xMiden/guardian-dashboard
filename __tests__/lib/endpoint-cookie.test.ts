import { describe, it, expect, beforeEach, vi } from "vitest";
import { signEndpointCookie, verifyEndpointCookie } from "@/lib/endpoint-cookie";

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
});

describe("endpoint cookie signing", () => {
  it("round-trips a signed cookie", () => {
    const cookie = signEndpointCookie("user_1", "openzeppelin");
    expect(verifyEndpointCookie("user_1", cookie)).toBe("openzeppelin");
  });

  it("rejects a hand-crafted endpoint id", () => {
    expect(verifyEndpointCookie("user_1", "openzeppelin")).toBeNull();
    expect(verifyEndpointCookie("user_1", "openzeppelin.forged-signature")).toBeNull();
  });

  it("rejects a cookie issued to a different user", () => {
    const cookie = signEndpointCookie("user_1", "openzeppelin");
    expect(verifyEndpointCookie("user_2", cookie)).toBeNull();
  });

  it("rejects a cookie whose endpoint id was swapped", () => {
    const cookie = signEndpointCookie("user_1", "openzeppelin");
    const sig = cookie.slice(cookie.lastIndexOf(".") + 1);
    expect(verifyEndpointCookie("user_1", `lambda.${sig}`)).toBeNull();
  });

  it("rejects missing or malformed values", () => {
    expect(verifyEndpointCookie("user_1", undefined)).toBeNull();
    expect(verifyEndpointCookie("user_1", "")).toBeNull();
    expect(verifyEndpointCookie("user_1", ".sig-without-id")).toBeNull();
  });
});
