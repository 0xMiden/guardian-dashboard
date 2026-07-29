"use client";
import { RefreshCw } from "lucide-react";

/**
 * Manual refresh control, shared by the panels that poll the node. Accounts move
 * quickly enough that a cache must never be the only way to get a current
 * number, so every polling panel gets one of these.
 */
export function RefreshButton({
  onClick,
  busy,
  title = "Refetch from the Guardian node, ignoring caches",
}: {
  onClick: () => void;
  busy: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1 text-muted-foreground transition-colors hover:text-foreground hover:border-zinc-500 disabled:opacity-50"
    >
      <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
