"use client";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/CopyableId";
import { formatAsset, type TokenInfo } from "@/lib/format";
import type { DashboardDeltaEntry } from "@openzeppelin/guardian-operator-client";

export const CATEGORY_LABELS: Record<string, string> = {
  asset_transfer: "Asset transfer",
  note_consumption: "Note consumed",
  note_creation: "Note created",
  account_storage_change: "Account changed",
  guardian_switch: "Switch Guardian",
  custom: "Custom",
};

/**
 * The operator's stated proposal type. Always the more specific view of the
 * same event: a walk of 2,233 deltas across the fleet on 2026-09-10 found no
 * pair where the category said something the proposal type contradicted, so
 * this is consulted first.
 *
 * Only types whose wire name is NOT the clearest human name belong here. The
 * rest are derived (see `derivedLabel`), because proposal types are defined by
 * the *applications* building on Miden and the Guardian files every one of them
 * under the generic `custom` category. Two arrived with testnet v0.16
 * (`recallable_send`, `bridged_send`) and four more by 2026-10-06
 * (`earn_deposit`, `b2agg`, `live_send`, `usdcx_v1_*`), so enumerating them is
 * a treadmill: a type nobody has added yet should read as itself, not as
 * "Custom".
 */
const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  p2id: "Asset transfer",
  consume_notes: "Note consumed",
  recallable_send: "Recallable send",
  bridged_send: "Bridged send",
  swap: "Swap",
  add_signer: "Signer added",
  remove_signer: "Signer removed",
  change_threshold: "Threshold changed",
  update_procedure_threshold: "Threshold changed",
  switch_guardian: "Switch Guardian",
  // Deriving this one gives "Midenid register".
  midenid_register: "Miden ID registered",
  // A genuinely custom script, so the generic word is the honest answer.
  custom_transaction: "Custom",
};

/**
 * Types that are a fixed prefix plus an encoded payload, where the payload must
 * not reach the label. `usdcx_v1_` is followed by ~1,500 characters of base32
 * holding a JSON recipe (`{"recipeVersion":1,"action":"set_max_supply",...}`);
 * 6 of 1,448 fleet deltas on 2026-10-06 were these, carrying `set_max_supply`
 * and `set_min_burn`. The label names the application, which is as much as can
 * be said without decoding base32 in the browser.
 */
const PROPOSAL_TYPE_PREFIXES: [prefix: string, label: string][] = [["usdcx_v1_", "USDCx"]];

/**
 * A wire name that looks like a deliberate snake_case token, in sentence case
 * like every curated label: `earn_deposit` reads "Earn deposit" without anyone
 * having to ship a release.
 *
 * The guard matters: a proposal type is server-supplied and goes straight into
 * a table cell, and one of the live ones is 1,500 characters of base32. Rather
 * than truncate that into nonsense, anything that does not look like a short
 * token is declined here and the caller falls back to the category.
 */
const SANE_TOKEN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function derivedLabel(proposalType: string): string | undefined {
  if (proposalType.length > 32 || !SANE_TOKEN.test(proposalType)) return undefined;
  const words = proposalType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function activityLabel(category?: string, proposalType?: string): string {
  if (proposalType) {
    const curated = PROPOSAL_TYPE_LABELS[proposalType];
    if (curated) return curated;
    const prefixed = PROPOSAL_TYPE_PREFIXES.find(([prefix]) => proposalType.startsWith(prefix));
    if (prefixed) return prefixed[1];
    const derived = derivedLabel(proposalType);
    if (derived) return derived;
  }
  if (category) return CATEGORY_LABELS[category] ?? category;
  return "State change";
}

/** Why a delta left the active path, in the operator's words rather than the wire's. */
const STATUS_REASONS: Record<string, string> = {
  retry_exhausted: "the Guardian ran out of retries verifying it",
  diverged: "the Guardian found it no longer matches the chain",
  client_abandoned: "the client stopped before submitting it",
};

/** What a status means, for the badge of a row that has no reason to give. */
const STATUS_HELP: Record<string, string> = {
  canonical: "Included by the chain.",
  candidate: "Submitted to the chain, awaiting confirmation.",
  retained: "The Guardian gave up verifying it and keeps it for later reconciliation.",
  discarded: "Dropped by the Guardian.",
};

export function statusReasonText(reason?: string): string | undefined {
  if (!reason) return undefined;
  return STATUS_REASONS[reason] ?? reason.replace(/_/g, " ");
}

/**
 * The word the badge shows for a delta status, also what the CSV exports.
 * `retained` arrived in Guardian 0.16.1 (issue #345): the Guardian gave up
 * verifying this candidate but keeps it for background reconciliation, so it
 * may still recover. "recovering" says that; the raw word does not.
 */
export function deltaStatusLabel(status: string): string {
  if (status === "canonical") return "confirmed";
  if (status === "candidate") return "submitted";
  if (status === "retained") return "recovering";
  return status;
}

export function proposalStatusLabel(collected: number, required: number): string {
  return `${collected}/${required} acknowledged`;
}

export function deltaStatusBadge(status: string, statusReason?: string) {
  // Recovering shares Frozen's tone: both wait on an operator, not on the chain.
  const tone = status === "canonical" ? "bg-state-active"
    : status === "candidate" ? "bg-state-pending"
    : status === "retained" ? "bg-state-frozen"
    : "bg-state-neutral";
  return (
    <Badge className={`${tone} text-white`} title={statusReasonText(statusReason) ?? STATUS_HELP[status]}>
      {deltaStatusLabel(status)}
    </Badge>
  );
}

export function proposalStatusBadge(collected: number, required: number) {
  const full = collected >= required;
  return (
    <Badge
      variant="outline"
      className={full ? "border-state-active text-state-active" : "border-state-pending text-state-pending"}
      title="Acknowledgements collected so far, out of the number this account requires."
    >
      {proposalStatusLabel(collected, required)}
    </Badge>
  );
}

export type AssetLike = { assetId?: string; amount?: string } & TokenInfo;

export function AmountCell({ assets }: { assets?: AssetLike[] }) {
  if (!assets || assets.length === 0) return <span className="text-muted-foreground">—</span>;
  const first = assets[0];
  if (!first.amount) return <span className="text-muted-foreground">—</span>;
  const positive = !first.amount.startsWith("-");
  const formatted = formatAsset(first.amount, first);
  const display = positive && !formatted.startsWith("+") ? "+" + formatted : formatted;
  const more = assets.length > 1 ? <span className="text-muted-foreground"> +{assets.length - 1}</span> : null;
  return (
    // A token no list names shows its raw figure, with the faucet on hover.
    <span className={`tabular-nums ${positive ? "text-state-active" : "text-state-error"}`} title={first.symbol ? undefined : first.assetId}>
      {display}{more}
    </span>
  );
}

export function CounterpartyCell({ counterparty }: { counterparty?: DashboardDeltaEntry["counterparty"] & { accountIdBech32?: string } }) {
  if (!counterparty) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{counterparty.direction === "in" ? "←" : "→"}</span>
      <CopyableId id={counterparty.accountIdBech32 ?? counterparty.accountId} prefixLen={8} suffixLen={4} />
    </span>
  );
}
