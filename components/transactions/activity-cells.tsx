"use client";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/CopyableId";
import { formatAmount } from "@/lib/format";
import type { DashboardDeltaEntry } from "@openzeppelin/guardian-operator-client";

export const CATEGORY_LABELS: Record<string, string> = {
  asset_transfer: "Asset Transfer",
  note_consumption: "Note Consumed",
  note_creation: "Note Created",
  account_storage_change: "Account Changed",
  guardian_switch: "Switch Guardian",
  custom: "Custom",
};

export function activityLabel(category?: string, proposalType?: string): string {
  if (category) return CATEGORY_LABELS[category] ?? category;
  switch (proposalType) {
    case "p2id": return "Asset Transfer";
    case "consume_notes": return "Note Consumed";
    case "add_signer": return "Signer Added";
    case "remove_signer": return "Signer Removed";
    case "change_threshold": return "Threshold Changed";
    case "update_procedure_threshold": return "Threshold Changed";
    case "switch_guardian": return "Switch Guardian";
    default: return "State Change";
  }
}

/** Why a delta left the active path, in the operator's words rather than the wire's. */
const STATUS_REASONS: Record<string, string> = {
  retry_exhausted: "the Guardian ran out of retries verifying it",
  diverged: "the Guardian found it no longer matches the chain",
  client_abandoned: "the client stopped before submitting it",
};

export function statusReasonText(reason?: string): string | undefined {
  if (!reason) return undefined;
  return STATUS_REASONS[reason] ?? reason.replace(/_/g, " ");
}

export function deltaStatusBadge(status: string, statusReason?: string) {
  if (status === "canonical") return <Badge className="bg-state-active text-white">confirmed</Badge>;
  if (status === "candidate") return <Badge className="bg-state-pending text-white">submitted</Badge>;
  // `retained` arrived in Guardian 0.16.1 (issue #345): the Guardian gave up
  // verifying this candidate but keeps it for background reconciliation, so it
  // may still recover. "recovering" says that; the raw word does not.
  if (status === "retained") {
    return (
      <Badge className="bg-state-pending text-white" title={statusReasonText(statusReason)}>
        recovering
      </Badge>
    );
  }
  return (
    <Badge className="bg-state-neutral text-white" title={statusReasonText(statusReason)}>
      {status}
    </Badge>
  );
}

export function proposalStatusBadge(collected: number, required: number) {
  const full = collected >= required;
  return (
    <Badge
      variant="outline"
      className={full ? "border-state-active text-state-active" : "border-state-pending text-state-pending"}
    >
      {collected}/{required} signed
    </Badge>
  );
}

export function AmountCell({ assets }: { assets?: DashboardDeltaEntry["assets"] }) {
  if (!assets || assets.length === 0) return <span className="text-muted-foreground">—</span>;
  const first = assets[0];
  if (!first.amount) return <span className="text-muted-foreground">—</span>;
  const positive = !first.amount.startsWith("-");
  const formatted = formatAmount(first.amount);
  const display = positive && !formatted.startsWith("+") ? "+" + formatted : formatted;
  const more = assets.length > 1 ? <span className="text-muted-foreground"> +{assets.length - 1}</span> : null;
  return (
    <span className={`tabular-nums ${positive ? "text-state-active" : "text-state-error"}`}>
      {display}{more}
    </span>
  );
}

export function CounterpartyCell({ counterparty }: { counterparty?: DashboardDeltaEntry["counterparty"] }) {
  if (!counterparty) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{counterparty.direction === "in" ? "←" : "→"}</span>
      <CopyableId id={counterparty.accountId} prefixLen={8} suffixLen={4} />
    </span>
  );
}
