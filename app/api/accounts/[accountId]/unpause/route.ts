import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client) => {
    const { accountId } = await params;
    const body = await req.json().catch(() => ({})) as { reason?: string };
    return client.unpauseAccount(accountId, body.reason?.trim() || undefined);
  });
}
