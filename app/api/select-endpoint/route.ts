import { auth, clerkClient } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";
import { getEndpoint, getPublicEndpoints } from "@/lib/endpoints";
import { signEndpointCookie } from "@/lib/endpoint-cookie";
import { getPostHogClient } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";

async function getAllowedIds(userId: string): Promise<string[]> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return (user.publicMetadata as { endpointIds?: string[] })?.endpointIds ?? [];
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ endpoints: [] });
  const allowedIds = await getAllowedIds(userId);
  const accessible = getPublicEndpoints().filter((e) => allowedIds.includes(e.id));
  return NextResponse.json({ endpoints: accessible });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A body that isn't JSON is a client error, not a 500: `req.json()` rejects on
  // malformed input, and an unhandled rejection here surfaced as an opaque
  // "Internal Server Error" with a stack trace in the server log.
  const { endpointId } = await req.json().catch(() => ({})) as { endpointId?: unknown };
  if (typeof endpointId !== "string") {
    return NextResponse.json({ error: "endpointId (string) is required" }, { status: 422 });
  }
  const allowedIds = await getAllowedIds(userId);
  if (!allowedIds.includes(endpointId) || !getEndpoint(endpointId)) {
    return NextResponse.json({ error: "Not authorized for this endpoint" }, { status: 403 });
  }
  getPostHogClient().capture({
    distinctId: userId,
    event: "endpoint_selected",
    properties: { endpoint_id: endpointId },
  });
  // flush after the response so the event isn't lost when the lambda freezes
  after(() => getPostHogClient().flush());
  const res = NextResponse.json({ ok: true });
  // This cookie is the stored result of the authorization check above, so it gets
  // the full set of flags: HttpOnly keeps it out of JS, SameSite=Lax keeps it off
  // cross-site subrequests, and Secure keeps it off plaintext HTTP. `secure` is
  // conditional only so that `next dev` over http://localhost still works —
  // NODE_ENV is "production" in every deployed environment.
  res.cookies.set("cockpit-endpoint", signEndpointCookie(userId, endpointId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("cockpit-endpoint");
  return res;
}
