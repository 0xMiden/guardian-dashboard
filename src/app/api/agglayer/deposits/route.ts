import { NextResponse } from "next/server";
import {
  type AgglayerDeposit,
  type AgglayerDepositStatus,
  bridgeStatusUrl,
  midenAccountToBridgeDestination,
} from "@/app/lib/agglayer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawDestinationAddress = searchParams.get("destinationAddress");
  const rawMidenAccountId = searchParams.get("midenAccountId");

  let destinationAddress: string;
  try {
    destinationAddress = rawDestinationAddress ?? midenAccountToBridgeDestination(rawMidenAccountId ?? "");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Miden account ID." },
      { status: 400 },
    );
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
    return NextResponse.json({ error: "destinationAddress must be a 20-byte hex address." }, { status: 400 });
  }

  // `fetch` rejects on DNS failure, connection refused, TLS error and timeout,
  // and `response.json()` rejects when the bridge service answers 200 with a body
  // that is not JSON. Neither was handled, so an unreachable or misbehaving bridge
  // surfaced as an unhandled rejection — a 500 with a stack trace — even though
  // this route already had a considered 502 for the `!response.ok` case. Both
  // failure modes now land on that same 502.
  let payload: { deposits?: AgglayerDeposit[] };
  try {
    const response = await fetch(bridgeStatusUrl(destinationAddress), {
      headers: { accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Bridge service returned ${response.status}.` },
        { status: 502 },
      );
    }

    payload = (await response.json()) as { deposits?: AgglayerDeposit[] };
  } catch (error) {
    // Kept out of the response body: the message names the internal bridge host
    // and port (CWE-209). The server log is the right place for it.
    console.error("[agglayer/deposits] bridge service unreachable:", error);
    return NextResponse.json({ error: "Bridge service is unreachable." }, { status: 502 });
  }

  const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];
  const body: AgglayerDepositStatus = {
    destinationAddress,
    deposits,
    latestDeposit: deposits[0] ?? null,
  };

  return NextResponse.json(body);
}
