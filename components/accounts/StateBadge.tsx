import { Badge } from "@/components/ui/badge";
import { accountState } from "@/lib/format";

// Frozen moved off orange: orange is the brand accent now, and a badge in it
// would read as something to click rather than a state the account is in.
const STATE_TONE: Record<string, string> = {
  released: "bg-state-released",
  frozen: "bg-state-frozen",
  active: "bg-state-active",
};

/** The lifecycle badge, one spelling for the table and the detail page. */
export function stateBadge(status: string, pausedAt: string | null, releasedAt?: string | null) {
  const state = accountState(status, pausedAt, releasedAt);
  return <Badge className={`${STATE_TONE[state] ?? "bg-state-neutral"} text-white`}>{state}</Badge>;
}
