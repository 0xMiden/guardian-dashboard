"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OverviewData {
  totalAccounts: number;
  falcon: number;
  ecdsa: number;
  evm: number;
  error?: string;
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
  const { data } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const [expanded, setExpanded] = useState(false);
  const loading = !data;
  const error = data?.error;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Accounts</p>
            {loading ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <p className="text-3xl font-bold leading-none">
                {error ? "—" : data!.totalAccounts}
              </p>
            )}
          </div>
          {!loading && !error && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {expanded && data && !error && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <Row label="Falcon" value={data.falcon} />
            <Row label="ECDSA" value={data.ecdsa} />
            {data.evm > 0 && <Row label="EVM" value={data.evm} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
