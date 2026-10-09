"use client";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { StatCard, StatRow, Absent } from "@/components/overview/StatCard";
import type { OverviewData } from "@/app/api/overview/route";

export function ActivityCard() {
  const { data, error } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });
  const counts = data?.deltaStatusCounts;
  // Guardians below 0.16.1 do not report `retained` at all.
  const recovering = counts?.retained ?? 0;

  return (
    <StatCard
      label="Activity"
      info="Transactions this Guardian has confirmed on chain, over its whole history. Expand for the other states and the proposals still collecting signatures."
      sub={data && "confirmed transactions, all time"}
      details={counts && data && (
        <>
          <StatRow label="Confirmed" value={counts.canonical} accent="text-state-active" />
          <StatRow label="Submitted" value={counts.candidate} accent={counts.candidate > 0 ? "text-state-pending" : undefined} />
          {/* Only when there are any: a permanent "Recovering 0" is a row of
              noise on every Guardian that never has one. */}
          {recovering > 0 && <StatRow label="Recovering" value={recovering} accent="text-state-frozen" />}
          <StatRow label="Discarded" value={counts.discarded} />
          {/* The one row that is not a transaction state. */}
          <StatRow
            label="Proposals awaiting signatures"
            value={data.inFlightProposalCount}
            accent={data.inFlightProposalCount > 0 ? "text-state-pending" : undefined}
          />
        </>
      )}
    >
      {counts ? formatCount(counts.canonical) : error ? <Absent error={error} /> : <Skeleton className="mt-1 h-8 w-12" />}
    </StatCard>
  );
}
