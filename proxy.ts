import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// Routes that don't require a Guardian endpoint cookie to be set
const skipEndpointCheck = createRouteMatcher([
  "/select-endpoint(.*)",
  "/api/select-endpoint(.*)",
  "/api/admin(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();

    if (!skipEndpointCheck(req)) {
      const endpointId = req.cookies.get("cockpit-endpoint")?.value;
      if (!endpointId) {
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
