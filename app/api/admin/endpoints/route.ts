import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getPublicEndpoints } from "@/lib/endpoints";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireAdmin();
  if (result instanceof NextResponse) return result;
  return NextResponse.json({ endpoints: getPublicEndpoints() });
}
