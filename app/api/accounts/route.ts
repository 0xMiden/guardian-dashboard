import { guardianRoute, pageOptions } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return guardianRoute((client) => client.listAccounts(pageOptions(req)));
}
