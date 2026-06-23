import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEndpoint } from "@/lib/endpoints";

export const dynamic = "force-dynamic";

type GuardianStatus = {
  status: string;
  version: string;
  environment: string;
  uptime_secs: number;
  started_at: string;
  git_commit: string;
};

const CACHE_TTL = 30_000;
const cache = new Map<string, { data: GuardianStatus; at: number }>();

export async function GET() {
  const h = await headers();
  const endpointId = h.get("x-guardian-endpoint-id") ?? "";
  if (!endpointId) return NextResponse.json({ error: "No endpoint selected" }, { status: 400 });

  const ep = getEndpoint(endpointId);
  if (!ep) return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 });

  const hit = cache.get(endpointId);
  if (hit && Date.now() - hit.at < CACHE_TTL) return NextResponse.json(hit.data);

  try {
    const res = await fetch(`${ep.url.replace(/\/$/, "")}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return NextResponse.json({ error: `Guardian returned ${res.status}` }, { status: 502 });
    const data = (await res.json()) as GuardianStatus;
    cache.set(endpointId, { data, at: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    const cached = cache.get(endpointId);
    if (cached) return NextResponse.json(cached.data);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unreachable" }, { status: 502 });
  }
}
