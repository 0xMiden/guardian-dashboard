import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "Transaction history is not yet available. Requires Guardian API support for GET /delta/since." },
    { status: 501 }
  );
}
