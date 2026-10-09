"use client";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { StatCard, StatRow, Absent } from "@/components/overview/StatCard";
import type { OverviewData } from "@/app/api/overview/route";

export function AccountsCard() {
  const { data, error } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });

  return (
    <StatCard
      label="Accounts"
      info="Every account registered with this Guardian."
      details={data && (
        <>
          <p className="text-xs text-muted-foreground">By signature scheme</p>
          {/* null when the Guardian has stopped computing the breakdown, above
              1,000 accounts. The total stays exact either way. */}
          {data.falcon === null ? (
            <p
              className="text-xs text-muted-foreground"
              title="This Guardian stops computing the breakdown by signature scheme above 1,000 accounts. The total above is still exact."
            >
              Breakdown unavailable on this Guardian
            </p>
          ) : (
            <>
              <StatRow label="Falcon" value={data.falcon} title="Falcon-512 post-quantum signatures, Miden's native scheme." />
              <StatRow label="ECDSA" value={data.ecdsa ?? 0} title="secp256k1 signatures, the scheme Ethereum wallets use." />
              {!!data.evm && <StatRow label="EVM" value={data.evm} title="Accounts keyed from an EVM chain. They hold no Miden vault." />}
            </>
          )}
        </>
      )}
    >
      {data ? formatCount(data.totalAccounts) : error ? <Absent error={error} /> : <Skeleton className="mt-1 h-8 w-12" />}
    </StatCard>
  );
}
