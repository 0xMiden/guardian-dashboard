import { NextResponse } from "next/server";

// Auth is now handled by Clerk. This route is kept as a stub.
export async function POST() {
  return NextResponse.json({ error: "Use Clerk sign-in" }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Use Clerk sign-out" }, { status: 410 });
}
