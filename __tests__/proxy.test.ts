import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signEndpointCookie } from "@/lib/endpoint-cookie";

/**
 * The auth gate and the endpoint-cookie enforcement had no test at all, so the
 * only check on them was starting the built output and curling routes by hand.
 * That mattered when `@clerk/nextjs` moved 7.5.16 to 7.8.0: nothing in the
 * suite would have noticed if the matchers had changed meaning underneath.
 *
 * `clerkMiddleware` is replaced by the identity function because it does the
 * session work, which needs a live Clerk instance. `createRouteMatcher` stays
 * real, so the patterns under test are the ones that ship.
 */
vi.mock("@clerk/nextjs/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/nextjs/server")>()),
  clerkMiddleware: (handler: unknown) => handler,
}));

const USER = "user_1";
const proxy = (await import("@/proxy")).default as unknown as (
  auth: { protect: () => Promise<{ userId: string }> },
  req: NextRequest,
) => Promise<Response | undefined>;

const auth = { protect: vi.fn() };
const request = (path: string, cookie?: string, spoofedEndpointId?: string) => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `cockpit-endpoint=${cookie}`;
  // Lets a test act as a client that hand-writes the header the app trusts.
  if (spoofedEndpointId) headers["x-guardian-endpoint-id"] = spoofedEndpointId;
  return new NextRequest(`https://dashboard.test${path}`, { headers });
};

/** The endpoint id the middleware hands to the app, or null when it sent none. */
const forwardedEndpointId = (res: Response | undefined) =>
  res?.headers.get("x-middleware-request-x-guardian-endpoint-id") ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
  auth.protect.mockResolvedValue({ userId: USER });
});

describe("proxy", () => {
  it("lets the sign-in page through without authenticating", async () => {
    expect(await proxy(auth, request("/sign-in"))).toBeUndefined();
    expect(auth.protect).not.toHaveBeenCalled();
  });

  it("hands the endpoint id to the app when the cookie verifies", async () => {
    const res = await proxy(auth, request("/overview", signEndpointCookie(USER, "testnet")));
    expect(auth.protect).toHaveBeenCalled();
    expect(forwardedEndpointId(res)).toBe("testnet");
  });

  it("sends a request with no cookie to endpoint selection", async () => {
    const res = await proxy(auth, request("/overview"));
    expect(res!.status).toBe(307);
    expect(res!.headers.get("location")).toBe("https://dashboard.test/select-endpoint");
  });

  // The signature is what stops a signed-in user picking someone else's
  // Guardian by editing a cookie, so a forged one has to fail closed.
  it("sends a forged cookie to endpoint selection", async () => {
    const res = await proxy(auth, request("/overview", "testnet.not-a-real-signature"));
    expect(res!.status).toBe(307);
  });

  it("sends a cookie issued to another user to endpoint selection", async () => {
    const res = await proxy(auth, request("/overview", signEndpointCookie("user_2", "testnet")));
    expect(res!.status).toBe(307);
  });

  // A correctly signed cookie for an endpoint that is no longer configured is
  // stale rather than hostile, and lands in the same place.
  it("sends a cookie for an unconfigured endpoint to endpoint selection", async () => {
    const res = await proxy(auth, request("/overview", signEndpointCookie(USER, "retired")));
    expect(res!.status).toBe(307);
  });

  it.each(["/select-endpoint", "/api/select-endpoint", "/admin", "/api/admin/users"])(
    "authenticates %s but asks it for no endpoint cookie",
    async (path) => {
      const res = await proxy(auth, request(path));
      expect(auth.protect).toHaveBeenCalled();
      // These paths are reachable before an endpoint is chosen, so the middleware
      // forwards no endpoint id at all. (It used to return `undefined` here; it
      // now returns a `next()` that carries the sanitized request headers, so the
      // assertion is on the absence of the id rather than the absence of a response.)
      expect(forwardedEndpointId(res)).toBeNull();
    },
  );

  // `x-guardian-endpoint-id` is how the middleware reports which Guardian the
  // caller was authorized for, and lib/guardian-route.ts trusts it verbatim, so a
  // caller writing that header must never be able to influence what the app sees.
  it("ignores a client-supplied endpoint header on a guarded path", async () => {
    const res = await proxy(
      auth,
      request("/overview", signEndpointCookie(USER, "testnet"), "attacker-chosen"),
    );
    expect(forwardedEndpointId(res)).toBe("testnet");
  });

  it.each(["/admin", "/api/admin/users"])(
    "strips a client-supplied endpoint header on %s, which sets none of its own",
    async (path) => {
      const res = await proxy(auth, request(path, undefined, "attacker-chosen"));
      expect(forwardedEndpointId(res)).toBeNull();
    },
  );
});
