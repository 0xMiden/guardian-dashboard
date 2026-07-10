import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";

export const dynamic = "force-dynamic";

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
