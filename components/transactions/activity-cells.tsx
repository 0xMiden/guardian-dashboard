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

export function deltaStatusBadge(status: string) {
  if (status === "canonical") return <Badge className="bg-emerald-500 text-white text-xs">Confirmed</Badge>;
  if (status === "candidate") return <Badge className="bg-amber-500 text-white text-xs">Submitted</Badge>;
  return <Badge className="bg-zinc-500 text-white text-xs capitalize">{status}</Badge>;
}

export function proposalStatusBadge(collected: number, required: number) {
  const full = collected >= required;
  return (
    <Badge
      variant="outline"
      className={`text-xs ${full ? "border-emerald-500 text-emerald-500" : "border-amber-500 text-amber-500"}`}
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
    <span className={`text-xs font-mono ${positive ? "text-emerald-400" : "text-red-400"}`}>
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
