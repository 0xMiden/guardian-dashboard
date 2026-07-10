import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Returns the Clerk client + caller id for admins, or the 401/403 response
// to send back. Callers: `if (result instanceof NextResponse) return result;`
export async function requireAdmin(): Promise<
  { client: Awaited<ReturnType<typeof clerkClient>>; userId: string } | NextResponse
> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if ((user.publicMetadata as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { client, userId };
}
