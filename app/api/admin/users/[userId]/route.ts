import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getPostHogClient } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const result = await requireAdmin();
  if (result instanceof NextResponse) return result;
  const { client, userId: callerId } = result;

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
