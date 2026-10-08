"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { InfoTip } from "@/components/ui/InfoTip";

interface OverviewData {
  totalAccounts: number;
  // null when the Guardian has stopped computing the breakdown, which it does above
  // a per-Guardian account threshold. The total stays exact either way.
  falcon: number | null;
  ecdsa: number | null;
  evm: number | null;
}

function Row({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  if (typeof value === "number") value = formatCount(value);
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground" title={title}>{label}</span>
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
            <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              Accounts
              <InfoTip text="Every account registered with this Guardian." />
            </p>
            {loading ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <p className="text-stat">
                {data ? formatCount(data.totalAccounts) : "—"}
              </p>
            )}
          </div>
          {data && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors mt-1"
              title={expanded ? "Collapse" : "Expand"}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {expanded && data && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <p className="text-xs text-muted-foreground">By signature scheme</p>
            {data.falcon === null ? (
              <p
                className="text-xs text-muted-foreground"
                title="This Guardian stops computing the breakdown by signature scheme above 1,000 accounts. The total above is still exact."
              >
                Breakdown unavailable on this Guardian
              </p>
            ) : (
              <>
                <Row label="Falcon" value={data.falcon} title="Falcon-512 post-quantum signatures, Miden's native scheme." />
                <Row label="ECDSA" value={data.ecdsa} title="secp256k1 signatures, the scheme Ethereum wallets use." />
                {!!data.evm && <Row label="EVM" value={data.evm} title="Accounts keyed from an EVM chain. They hold no Miden vault." />}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
