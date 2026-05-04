import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<{ client: Awaited<ReturnType<typeof clerkClient>>; userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if ((user.publicMetadata as { role?: string })?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { client, userId };
}

export async function GET() {
  const result = await requireAdmin();
  if (result instanceof NextResponse) return result;
  const { client } = result;
  const { data: users } = await client.users.getUserList({ limit: 100 });
  return NextResponse.json(users.map((u) => ({
    id: u.id,
    email: u.emailAddresses[0]?.emailAddress ?? null,
    firstName: u.firstName,
    lastName: u.lastName,
    publicMetadata: u.publicMetadata,
  })));
}
