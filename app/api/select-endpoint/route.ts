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
  const { endpointId } = await req.json();
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
  res.cookies.set("cockpit-endpoint", signEndpointCookie(userId, endpointId), { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("cockpit-endpoint");
  return res;
}
