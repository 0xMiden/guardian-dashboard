"use client";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OverviewData {
  totalAccounts: number;
  falcon: number;
  ecdsa: number;
  evm: number;
  deltaStatusCounts: { candidate: number; canonical: number; discarded: number };
  inFlightProposalCount: number;
  serviceStatus: "healthy" | "degraded";
  error?: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function AccountSummaryCard() {
  const { data } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Summary</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {!data ? (
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="my-2 h-5 w-full" />)
        ) : data.error ? (
          <p className="py-4 text-xs text-muted-foreground">Guardian unreachable</p>
        ) : (
          <>
            <Row
              label="Status"
              value={
                <span className={data.serviceStatus === "healthy" ? "text-emerald-400" : "text-amber-400"}>
                  {data.serviceStatus}
                </span>
              }
            />
            <Row label="Total accounts" value={data.totalAccounts} />
            <Row label="Falcon" value={data.falcon} />
            <Row label="ECDSA" value={data.ecdsa} />
            {data.evm > 0 && <Row label="EVM" value={data.evm} />}
            <Row
              label="Canonical deltas"
              value={<span className="text-emerald-400">{data.deltaStatusCounts.canonical}</span>}
            />
            <Row
              label="Candidate deltas"
              value={data.deltaStatusCounts.candidate > 0
                ? <span className="text-amber-400">{data.deltaStatusCounts.candidate}</span>
                : "0"}
            />
            <Row
              label="In-flight proposals"
              value={data.inFlightProposalCount > 0
                ? <span className="text-amber-400">{data.inFlightProposalCount}</span>
                : "0"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
