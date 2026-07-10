import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId: callerId } = await auth();
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await clerkClient();
  const caller = await client.users.getUser(callerId);
  if ((caller.publicMetadata as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const { endpointIds, role } = await req.json().catch(() => ({})) as { endpointIds?: string[]; role?: string };
  // publicMetadata is replaced wholesale — require both fields so a partial
  // PATCH can't silently demote a user or wipe their endpoints
  if (!Array.isArray(endpointIds) || typeof role !== "string") {
    return NextResponse.json({ error: "endpointIds (array) and role (string) are required" }, { status: 422 });
  }

  await client.users.updateUser(userId, {
    publicMetadata: { endpointIds, role },
  });
  getPostHogClient().capture({
    distinctId: callerId,
    event: "user_access_updated",
    properties: {
      target_user_id: userId,
      role,
      endpoint_count: endpointIds.length,
    },
  });
  return NextResponse.json({ ok: true });
}
