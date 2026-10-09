"use client";
import useSWR from "swr";
import Link from "next/link";
import { CircleCheck, ArrowRightFromLine, Snowflake, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/Timestamp";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { StatCard, Absent } from "@/components/overview/StatCard";
import { STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";
import type { OverviewData } from "@/app/api/overview/route";

/**
 * Every account by lifecycle, in the Guardian's own split, then when it last
 * recorded activity. A count leads to the Accounts table with that status
 * selected; zero reads "None", since a big grey 0 reads as missing data.
 */
export function LifecycleCards() {
  const { data: stats, error: statsError } = useSWR<AccountStats>(STATS_KEY, fetcher, { refreshInterval: 60_000 });
  const { data: overview, error: overviewError } = useSWR<OverviewData>("/api/overview", fetcher, {
    refreshInterval: 30_000,
  });
  const count = (value: number | undefined, href: string) =>
    stats == null ? (statsError ? <Absent error={statsError} /> : <Skeleton className="h-8 w-16" />)
    // A 0.17.0 Guardian has no aggregate, and a fresh 0.18.0 one not yet: the
    // same two cases StatStrip spells out.
    : value == null ? <Absent title={stats.unsupported ? "Needs Guardian 0.18.0" : "Calculating…"} />
    : value ? <Link href={href} className="hover:underline">{formatCount(value)}</Link>
    : <Absent>None</Absent>;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={<CircleCheck className="h-3.5 w-3.5" />}
          label="Active accounts"
          info="Accounts this Guardian acknowledges transactions for, neither frozen nor released."
        >
          {count(stats?.active, "/accounts?state=active")}
        </StatCard>
        <StatCard
          icon={<ArrowRightFromLine className="h-3.5 w-3.5" />}
          label="Released accounts"
          info="Accounts moved to another Guardian. This one no longer acknowledges their transactions."
        >
          {count(stats?.released, "/accounts?state=released")}
        </StatCard>
        <StatCard
          icon={<Snowflake className="h-3.5 w-3.5" />}
          label="Frozen accounts"
          info="Accounts paused by the operator. No transaction is acknowledged for them until they are unfrozen."
          attention={!!stats?.frozen}
        >
          {count(stats?.frozen, "/accounts?state=frozen")}
        </StatCard>
        <StatCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Last activity"
          info="When this Guardian last recorded a transaction or a proposal."
        >
          {overview === undefined ? (
            overviewError ? <Absent error={overviewError} /> : <Skeleton className="h-8 w-28" />
          ) : overview.latestActivity ? (
            // Smaller than the counts beside it: a timestamp needs more room and
            // reads as a phrase rather than a figure.
            <span className="text-section">
              <Timestamp iso={overview.latestActivity} />
            </span>
          ) : (
            <Absent><span className="text-section">Nothing recorded</span></Absent>
          )}
        </StatCard>
      </div>
      {/* The lifecycle counts and the asset total come from an aggregate the
          Guardian refreshes on its own cadence, while the Accounts and
          Activity cards read live figures, so they can disagree for a few
          minutes. The time says how old the aggregate is. */}
      {stats?.asOf && (
        <p className="self-end text-xs text-muted-foreground">
          Statistics as of {new Date(stats.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
