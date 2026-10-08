"use client";
import useSWR from "swr";
import Link from "next/link";
import { CircleCheck, ArrowRightFromLine, Snowflake, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timestamp } from "@/components/ui/Timestamp";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { describeError } from "@/components/ui/ErrorPanel";
import { InfoTip } from "@/components/ui/InfoTip";
import { STATS_KEY, type AccountStats } from "@/components/accounts/StatStrip";

/**
 * Every account by lifecycle, in the Guardian's own split, then when it last
 * recorded activity.
 *
 * Zero is written as "None" rather than a big grey 0, which reads as missing
 * data; for Frozen it is the good answer and styled as reassurance. A count
 * leads to the Accounts table with that status selected. Frozen goes through
 * the Guardian's own paused filter, which finds those accounts wherever they
 * sit in the list; the other two preselect the status chip over the rows the
 * table has loaded.
 */
function Stat({
  icon,
  label,
  info,
  children,
  tone = "quiet",
}: {
  icon: React.ReactNode;
  label: string;
  info: string;
  children: React.ReactNode;
  tone?: "quiet" | "attention";
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="mb-1 flex items-center gap-1.5 text-label text-muted-foreground">
          {icon}
          {label}
          <InfoTip text={info} />
        </p>
        <div className={tone === "attention" ? "text-stat text-state-frozen" : "text-stat text-muted-foreground"}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export function AttentionCards() {
  // Same key the accounts table already polls, so SWR serves both from one request.
  const { data: stats, error: statsError } = useSWR<AccountStats>(STATS_KEY, fetcher, { refreshInterval: 60_000 });
  const { data: overview, error: overviewError } = useSWR<{ latestActivity?: string | null }>("/api/overview", fetcher, {
    refreshInterval: 30_000,
  });
  // A skeleton that never ends says nothing; a dash with the reason does.
  const failed = (error: unknown) => <span title={describeError(error).detail}>—</span>;

  const count = (value: number | undefined, href: string) =>
    stats == null ? (statsError ? failed(statsError) : <Skeleton className="h-8 w-16" />)
    // A 0.17.0 Guardian has no aggregate, and a fresh 0.18.0 one not yet: the
    // same two cases StatStrip spells out.
    : value == null ? <span title={stats.unsupported ? "Needs Guardian 0.18.0" : "Calculating…"}>—</span>
    : value ? <Link href={href} className="hover:underline">{formatCount(value)}</Link>
    : "None";

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          icon={<CircleCheck className="h-3.5 w-3.5" />}
          label="Active accounts"
          info="Accounts this Guardian acknowledges transactions for, neither frozen nor released."
        >
          {count(stats?.active, "/accounts?state=active")}
        </Stat>
        <Stat
          icon={<ArrowRightFromLine className="h-3.5 w-3.5" />}
          label="Released accounts"
          info="Accounts moved to another Guardian. This one no longer acknowledges their transactions."
        >
          {count(stats?.released, "/accounts?state=released")}
        </Stat>
        <Stat
          icon={<Snowflake className="h-3.5 w-3.5" />}
          label="Frozen accounts"
          info="Accounts paused by the operator. No transaction is acknowledged for them until they are unfrozen."
          tone={stats?.frozen ? "attention" : "quiet"}
        >
          {count(stats?.frozen, "/accounts?state=frozen")}
        </Stat>
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Last activity"
          info="When this Guardian last recorded a transaction or a proposal."
        >
          {overview === undefined ? (
            overviewError ? failed(overviewError) : <Skeleton className="h-8 w-28" />
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
