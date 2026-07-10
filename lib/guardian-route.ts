import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getGuardianClient } from "./guardian-client";

// Shared wrapper for the guardian-proxy routes: resolves the endpoint header
// set by the middleware, and maps thrown errors to a 503 with the message in
// the body. Callbacks may return a NextResponse for non-default statuses.
export async function guardianRoute(
  fn: (client: ReturnType<typeof getGuardianClient>) => Promise<unknown>,
): Promise<NextResponse> {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });
  try {
    const data = await fn(getGuardianClient(endpointId));
    return data instanceof NextResponse ? data : NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

// Shared cursor/limit query parsing (drops invalid limits instead of
// forwarding NaN to the guardian node).
export function pageOptions(req: Request): { cursor?: string; limit?: number } {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "", 10);
  return {
    cursor: searchParams.get("cursor") ?? undefined,
    limit: Number.isNaN(limit) ? undefined : limit,
  };
}
