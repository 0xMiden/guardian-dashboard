import { guardianRoute } from "@/lib/guardian-route";

export const dynamic = "force-dynamic";

export function GET() {
  return guardianRoute((client) => client.getDashboardInfo());
}
