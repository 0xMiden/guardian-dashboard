"use client";
import useSWR from "swr";
import Link from "next/link";
import { Snowflake, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/Timestamp";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";

/**
 * The band that answers "is anything wrong".
 *
 * Overview used to lead with total accounts, total assets and lifetime
 * transactions: two inventory figures and a historical one, none of which
 * changes what an operator does today. These three do.
 *
 * Zero is the good answer here, so it is styled as reassurance rather than as
 * an empty slot. A muted "None" reads as "checked, nothing to do"; a big grey
 * 0 reads as missing data.
 *
 * There is deliberately no "released accounts" count. The Guardian documents a
 * `releasedAt` on every summary, meaning the account moved to a different
 * guardian, but it is null on all 2,270 accounts across all five configured
 * endpoints, every one of which reports `stateStatus: "available"`. Since
 * accounts are known to have moved away, either the server does not record it
 * on v0.16.0 or a released account leaves the inventory entirely. A count that
 * can only ever read "None" would assert something false.
 */
function Stat({
  icon,
  label,
  children,
  tone = "quiet",
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  tone?: "quiet" | "attention";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="mb-1 flex items-center gap-1.5 text-label text-muted-foreground">
          {icon}
          {label}
        </p>
        <div className={tone === "attention" ? "text-stat text-state-frozen" : "text-stat text-muted-foreground"}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export function AttentionCards() {
  // Same key the accounts table already polls, so SWR serves both from one
  // request and the counts cost nothing on top of the walk that route runs.
  const { data: stats } = useSWR<AccountStats>(STATS_KEY, fetcher, { refreshInterval: 60_000 });
  const { data: overview } = useSWR<{ latestActivity?: string | null }>("/api/overview", fetcher, {
    refreshInterval: 30_000,
  });

  const frozen = stats?.frozen;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Stat
        icon={<Snowflake className="h-3.5 w-3.5" />}
        label="Frozen accounts"
        tone={frozen ? "attention" : "quiet"}
      >
        {stats == null ? (
          <Skeleton className="h-8 w-16" />
        ) : frozen ? (
          // The count is only useful if it leads somewhere. The Guardian filters
          // by pause state natively, so this is one request rather than a walk.
          <Link href="/accounts?paused=true" className="hover:underline">
            {formatCount(frozen)}
          </Link>
        ) : (
          "None"
        )}
      </Stat>

      <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Last activity">
        {overview === undefined ? (
          <Skeleton className="h-8 w-28" />
        ) : overview.latestActivity ? (
          // Smaller than the counts beside it: a timestamp needs more room and
          // reads as a phrase rather than a figure.
          <span className="text-section">
            <Timestamp iso={overview.latestActivity} />
          </span>
        ) : (
          <span className="text-section">Nothing recorded</span>
        )}
      </Stat>
    </div>
  );
}
