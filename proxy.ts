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
  if (!isPublic(req)) {
    const { userId } = await auth.protect();

    if (!skipEndpointCheck(req)) {
      // The cookie is signed and user-bound (lib/endpoint-cookie.ts) — a
      // forged or stale value falls through to endpoint re-selection.
      const cookie = req.cookies.get("cockpit-endpoint")?.value;
      const endpointId = verifyEndpointCookie(userId, cookie);
      if (!endpointId || !getEndpoint(endpointId)) {
        return NextResponse.redirect(new URL("/select-endpoint", req.url));
      }
      const headers = new Headers(req.headers);
      headers.set("x-guardian-endpoint-id", endpointId);
      return NextResponse.next({ request: { headers } });
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
