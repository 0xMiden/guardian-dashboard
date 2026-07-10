import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  return guardianRoute(async (client) => client.getAccountSnapshot((await params).accountId));
}
