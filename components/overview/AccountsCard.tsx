"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fetcher } from "@/lib/utils";

interface OverviewData {
  totalAccounts: number;
  // null when the node has stopped computing the breakdown, which it does above
  // a per-node account threshold. The total stays exact either way.
  falcon: number | null;
  ecdsa: number | null;
  evm: number | null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function AccountsCard() {
  const { data, error } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const [expanded, setExpanded] = useState(false);
  const loading = !data && !error;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Accounts</p>
            {loading ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <p className="text-stat">
                {data ? data.totalAccounts : "—"}
              </p>
            )}
          </div>
          {data && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {expanded && data && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            {data.falcon === null ? (
              <p
                className="text-xs text-muted-foreground"
                title="This Guardian node stops computing the per-auth-method breakdown above a certain account count. The total above is still exact."
              >
                Breakdown unavailable on this node
              </p>
            ) : (
              <>
                <Row label="Falcon" value={data.falcon} />
                <Row label="ECDSA" value={data.ecdsa} />
                {!!data.evm && <Row label="EVM" value={data.evm} />}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
