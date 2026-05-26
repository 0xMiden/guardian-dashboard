"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AssetTotals = {
  usd7d: number;
  usd30d: number;
  computedAt: string;
  inProgress?: boolean;
  cached?: { usd7d: number; usd30d: number } | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function AssetsCard() {
  const { data } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, {
    refreshInterval: 15_000,
  });
  const [expanded, setExpanded] = useState(false);

  const ready = data && !data.inProgress;
  const stale = data?.inProgress && data.cached;
  const computing = data?.inProgress && !data.cached;

  const usd7d  = ready ? data.usd7d  : stale ? data.cached!.usd7d  : null;
  const usd30d = ready ? data.usd30d : stale ? data.cached!.usd30d : null;

  const headline = usd30d !== null
    ? `$${usd30d.toLocaleString()}`
    : computing
    ? "Computing…"
    : null;

  const canExpand = usd7d !== null && usd30d !== null;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              Assets{stale && <span className="ml-1 text-zinc-500">(updating…)</span>}
            </p>
            {headline === null && !computing ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <p className="text-3xl font-bold leading-none text-foreground">
                {headline}
              </p>
            )}
          </div>
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {expanded && canExpand && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <Row label="Last 7 days" value={`$${usd7d!.toLocaleString()}`} />
            <Row label="Last 30 days" value={`$${usd30d!.toLocaleString()}`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
