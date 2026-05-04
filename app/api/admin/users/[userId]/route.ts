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
  const { endpointIds, role } = await req.json() as { endpointIds?: string[]; role?: string };

  await client.users.updateUser(userId, {
    publicMetadata: { endpointIds: endpointIds ?? [], role: role ?? "viewer" },
  });
  getPostHogClient().capture({
    distinctId: callerId,
    event: "user_access_updated",
    properties: {
      target_user_id: userId,
      role: role ?? "viewer",
      endpoint_count: (endpointIds ?? []).length,
    },
  });
  return NextResponse.json({ ok: true });
}
