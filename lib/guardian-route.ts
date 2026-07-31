import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import { getGuardianClient } from "./guardian-client";

// Shared wrapper for the guardian-proxy routes: resolves the endpoint header
// set by the middleware, and maps thrown errors into a body the UI can act on.
//
// Everything used to collapse to a 503 carrying `err.message`, which is the
// Error text the client builds ("Guardian operator HTTP error 403: Forbidden -
// ..."). A missing permission, a rate limit and a dead node all arrived looking
// the same, so a panel could only echo HTTP at the operator. The node already
// sends a `meta` envelope the 0.16.0 client parses onto `err.data`; forwarding
// it alongside the real status is what lets `ErrorPanel` name the problem.
//
// Callbacks may return a NextResponse for non-default statuses.
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
    if (err instanceof GuardianOperatorHttpError) {
      return NextResponse.json({
        // `data.message` is the node's short, user-safe text (feature
        // 009-human-readable-errors); `err.message` is the diagnostic form.
        error: err.data?.message ?? err.message,
        code: err.data?.code,
        missingPermissions: err.data?.missingPermissions,
        retryAfterSecs: err.retryAfterSecs,
      }, { status: err.status });
    }
    // Anything that never reached the node: DNS, TLS, timeout, config.
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
