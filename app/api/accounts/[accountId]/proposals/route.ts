import { guardianRoute, pageOptions } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client) =>
    client.listAccountProposals((await params).accountId, pageOptions(req))
  );
}
