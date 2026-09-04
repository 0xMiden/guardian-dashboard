import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { verifyEndpointCookie } from "@/lib/endpoint-cookie";
import { getEndpoint } from "@/lib/endpoints";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Routes that don't require a Guardian endpoint cookie to be set
const skipEndpointCheck = createRouteMatcher([
  "/select-endpoint(.*)",
  "/api/select-endpoint(.*)",
  "/admin(.*)",
  "/api/admin(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;

  const { userId } = await auth.protect();

  // `x-guardian-endpoint-id` is an authorization *result*, not an input:
  // lib/guardian-route.ts reads it as "the middleware already checked that this
  // user may talk to this Guardian". A request header of the same name is
  // attacker-supplied, so it is deleted here for every authenticated request
  // before any handler can observe it. The guarded branch below re-adds the
  // value this middleware derived itself; the skip-list branch leaves it absent,
  // which is what `guardianRoute` turns into a 400. Without this delete, the
  // skip-list paths (/admin, /api/admin, /select-endpoint) forwarded the client's
  // own copy untouched — no route reads it there today, but nothing stopped a
  // future admin route from trusting a value the caller chose.
  const headers = new Headers(req.headers);
  headers.delete("x-guardian-endpoint-id");

  if (!skipEndpointCheck(req)) {
    // The cookie is signed and user-bound (lib/endpoint-cookie.ts) — a
    // forged or stale value falls through to endpoint re-selection.
    const cookie = req.cookies.get("cockpit-endpoint")?.value;
    const endpointId = verifyEndpointCookie(userId, cookie);
    if (!endpointId || !getEndpoint(endpointId)) {
      return NextResponse.redirect(new URL("/select-endpoint", req.url));
    }
    headers.set("x-guardian-endpoint-id", endpointId);
  }

  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
