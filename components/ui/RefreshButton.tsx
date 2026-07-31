"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

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
    <Button onClick={onClick} disabled={busy} title={title} size="sm">
      <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
