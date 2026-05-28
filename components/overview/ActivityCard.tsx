"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OverviewData {
  deltaStatusCounts: { candidate: number; canonical: number; discarded: number };
  inFlightProposalCount: number;
  error?: string;
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

export function ActivityCard() {
  const { data } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const [expanded, setExpanded] = useState(false);
  const loading = !data;
  const error = data?.error;

  const confirmed = data?.deltaStatusCounts.canonical;

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Transactions</p>
            {loading ? (
              <Skeleton className="h-8 w-12 mt-1" />
            ) : (
              <p className="text-3xl font-bold leading-none">
                {error ? "—" : confirmed}
              </p>
            )}
            {!loading && !error && (
              <p className="text-xs text-muted-foreground mt-1">confirmed</p>
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
            <Row
              label="Confirmed"
              value={data.deltaStatusCounts.canonical}
              accent="text-emerald-400"
            />
            <Row
              label="In progress"
              value={data.deltaStatusCounts.candidate}
              accent={data.deltaStatusCounts.candidate > 0 ? "text-amber-400" : undefined}
            />
            <Row
              label="Awaiting signatures"
              value={data.inFlightProposalCount}
              accent={data.inFlightProposalCount > 0 ? "text-amber-400" : undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
