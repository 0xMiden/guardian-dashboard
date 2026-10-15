"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, AlertTriangle, Check, Info } from "lucide-react";
import { InfoTip } from "@/components/ui/InfoTip";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { CopyableId } from "@/components/ui/CopyableId";
import { describeError } from "@/components/ui/ErrorPanel";
import type { OverviewData } from "@/app/api/overview/route";

interface HealthData {
  status: "up" | "down";
  latencyMs: number;
  checkedAt: string;
  sessionMaxTtlSeconds?: number;
}


// The Guardian names what it cannot compute in its own vocabulary. An operator
// should not have to know that `accounts_by_auth_method` is the auth split.
const DEGRADED_LABELS: Record<string, string> = {
  accounts_by_auth_method: "the account breakdown by signature scheme",
};
const describeDegraded = (keys: string[]) =>
  keys.map((k) => DEGRADED_LABELS[k] ?? k.replace(/_/g, " ")).join(", ");

// Aggregates the Guardian declines to compute above an account-count threshold,
// as opposed to ones it failed at. OZ confirmed (2026-08-21) that
// `accounts_by_auth_method` is capped at 1000 accounts on purpose, because it is
// computed per request: past the limit it is dropped and `service_status` reads
// `degraded` from then on. Their Guardian is at 7,198 accounts (2026-08-21) and
// gaining ~200 a day, so for any Guardian in real use this is the steady state.
// A stated limit gets an explanation; a degraded status we cannot account for
// keeps its warning.
//
// The 1000 is written into the copy below and does not come over the wire, so it
// has to be changed by hand if OZ raises the cap. They are weighing it, and the
// aggregation service that replaces the per-request computation is in flight.
// The copy below also speaks for exactly one aggregate; a second entry here
// needs its own sentence.
const CAPPED_AGGREGATES = new Set(["accounts_by_auth_method"]);

interface OperatorInfo {
  url: string;
  network: string;
  publicKey: string | null;
}

// The network is a label, not a state, so it no longer borrows status hues.
// MidenTestnet was amber, which also meant "submitted" and "pending" elsewhere.
// Mainnet keeps a tint, because which chain you are pointed at is worth a
// glance before an irreversible action.
const networkColor = (network: string) => (network === "MidenMainnet" ? "bg-state-active" : "bg-state-neutral");

// Named because the card states the cadence to the reader, and a figure in
// the copy that can drift from the actual interval is a lie waiting to happen.
const HEALTH_POLL_MS = 5000;

type LatencySample = { t: number; ms: number };

/**
 * Latency samples survive leaving the Overview tab, because the card is
 * unmounted on every navigation and a fresh chart needs two polls (10s) before
 * it can draw a line at all.
 *
 * Keyed by endpoint URL, which is the part that matters: an earlier version kept
 * these in a module-level array and plotted one Guardian's latency as
 * another's after switching endpoints. sessionStorage also scopes them to the
 * tab, so two tabs on different Guardians cannot contaminate each other.
 *
 * // ponytail: sessionStorage, so history is per tab and gone when it closes.
 * // Fine for a live latency sparkline; a real retention window would need the
 * // Guardian to serve its own health history.
 */
const SAMPLES_KEY = "guardian:latency";
const MAX_SAMPLES = 20;
// Beyond this a sample says nothing about current latency, and plotting it next
// to a fresh one implies continuity the chart does not have.
const MAX_SAMPLE_AGE_MS = 10 * 60 * 1000;

function readSamples(url: string): LatencySample[] {
  try {
    const raw = sessionStorage.getItem(`${SAMPLES_KEY}:${url}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_SAMPLE_AGE_MS;
    return parsed.filter(
      (s): s is LatencySample =>
        !!s && typeof s.t === "number" && typeof s.ms === "number" && s.t > cutoff,
    );
  } catch {
    return []; // private mode, quota, or a shape we no longer write
  }
}

function appendSample(url: string, ms: number): LatencySample[] {
  const next = [...readSamples(url), { t: Date.now(), ms }].slice(-MAX_SAMPLES);
  try {
    sessionStorage.setItem(`${SAMPLES_KEY}:${url}`, JSON.stringify(next));
  } catch {
    // over quota or blocked — the chart still works for this mount
  }
  return next;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Row({ label, value, sub, info }: { label: string; value: React.ReactNode; sub?: React.ReactNode; info?: string }) {
  return (
    <div className="flex items-start gap-3 py-1 text-sm">
      <span className="text-muted-foreground w-24 shrink-0 flex items-center gap-1">
        {label}
        {info && <InfoTip text={info} />}
      </span>
      <span className="font-medium">
        {value}
        {sub && <span className="block text-xs text-muted-foreground font-normal">{sub}</span>}
      </span>
    </div>
  );
}

export function GuardianStatusCard() {

  const { data: opInfo, error: opInfoError } = useSWR<OperatorInfo>("/api/operator-info", fetcher);
  const endpointUrl = opInfo?.url;

  // Read from storage as soon as the endpoint is known, and again if it changes.
  // Adjusting during render rather than in an effect, because waiting for a
  // commit (or worse, for the next health poll) is what left the chart empty:
  // SWR does not revalidate a hidden tab, so "when the next fetch lands" can be
  // minutes away, and this card is meant to show the samples it already has.
  const [samples, setSamples] = useState<{ url?: string; list: LatencySample[] }>({ list: [] });
  if (endpointUrl && samples.url !== endpointUrl) {
    setSamples({ url: endpointUrl, list: readSamples(endpointUrl) });
  }

  const { data: health, error: healthError } = useSWR<HealthData>("/api/health", fetcher, {
    refreshInterval: HEALTH_POLL_MS,
    // A sample that cannot be attributed to an endpoint is dropped rather than
    // guessed at. `opInfo` resolves alongside the first health poll, so at worst
    // this skips one 5s sample on a cold load.
    onSuccess: (d) => {
      if (endpointUrl) setSamples({ url: endpointUrl, list: appendSample(endpointUrl, d.latencyMs) });
    },
  });

  const { data: overview } = useSWR<OverviewData>("/api/overview", fetcher, { refreshInterval: 30_000 });

  const history = samples.list;
  const isUp = health?.status === "up";
  const build = overview?.build;
  const degradedAggregates = overview?.degradedAggregates ?? [];
  const cappedOnly =
    degradedAggregates.length > 0 && degradedAggregates.every((k) => CAPPED_AGGREGATES.has(k));

  // Uptime is derived from the two timestamps the polls already carry, rather
  // than from state set in `onSuccess`. A cache read fires no success callback,
  // so leaving the Overview tab and coming straight back was enough to leave
  // this reading "—" under a "since ..." line that was clearly populated.
  // `checkedAt` is the clock: it arrives as data, so this stays a pure function
  // of what the Guardian reported and still advances with every 5s poll.
  const startedMs = build?.startedAt ? new Date(build.startedAt).getTime() : NaN;
  const checkedMs = health ? new Date(health.checkedAt).getTime() : NaN;
  const uptimeSecs = Number.isFinite(startedMs) && Number.isFinite(checkedMs)
    ? Math.max(0, Math.floor((checkedMs - startedMs) / 1000))
    : null;
  const queueDepth = overview?.queueDepth;
  const sessionTtl = health?.sessionMaxTtlSeconds;
  const hasDetails = !!(build?.gitCommit && build.gitCommit !== "unknown") || !!opInfo?.publicKey
    || queueDepth !== undefined || sessionTtl !== undefined;

  return (
    <Card>
      <CardTitle>Guardian status</CardTitle>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: heartbeat + sparkline */}
          <div className="min-w-0">
            {!health ? (
              healthError ? (
                <div className="flex items-center gap-3">
                  <Badge variant="destructive">Offline</Badge>
                  <span className="text-label text-muted-foreground">{describeError(healthError).detail}</span>
                </div>
              ) : (
                <Skeleton className="h-10 w-32" />
              )
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={isUp ? "default" : "destructive"}
                    className={isUp ? "bg-state-active" : ""}
                  >
                    {isUp ? "Online" : "Offline"}
                  </Badge>
                  {/* The chart caption below says what this is. */}
                  <span className="text-title">{formatCount(health.latencyMs)} ms</span>
                </div>
                {/* The wall clock, not a relative time. At a 5s poll "2
                    seconds ago" is always true and therefore says nothing;
                    the actual time is what tells you the chart is live and
                    what its x-axis means. */}
                <p className="mt-1 text-label text-muted-foreground">
                  Last checked {new Date(health.checkedAt).toLocaleTimeString()} · polling every {HEALTH_POLL_MS / 1000}s
                </p>
              </>
            )}

            {/* Two different questions. Reachability is our ping; this is the
                server's own verdict, which it reports and we used to discard.
                A green badge over a Guardian calling itself degraded is worse than
                no badge at all. */}
            {overview?.serviceStatus && (
              <div className="mt-3 flex items-start gap-2">
                {overview.serviceStatus === "healthy" ? (
                  <>
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-active" />
                    <p className="text-label text-muted-foreground">
                      The Guardian reports itself healthy
                    </p>
                  </>
                ) : cappedOnly ? (
                  <>
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <p className="text-label text-muted-foreground">
                      The Guardian reports itself degraded: {describeDegraded(degradedAggregates)}{" "}
                      stops computing above 1,000 accounts.
                    </p>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-frozen" />
                    <p className="text-label text-state-frozen">
                      The Guardian reports itself degraded
                      {degradedAggregates.length
                        ? `: it cannot compute ${describeDegraded(degradedAggregates)}.`
                        : "."}
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="mt-3 h-32 w-full">
              {history.length > 1 && (
                <>
                  <p className="text-label text-muted-foreground">Last {history.length} pings</p>
                  <ResponsiveContainer width="100%" height={112} minWidth={0}>
                    <LineChart data={history}>
                      <Line type="monotone" dataKey="ms" stroke="var(--color-brand)" dot={false} strokeWidth={2} />
                      <Tooltip
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg bg-background px-2 py-1 text-xs shadow-lg border">
                              {payload[0].value}ms
                            </div>
                          ) : null
                        }
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          </div>

          {/* Right: info rows */}
          <div className="divide-y">
            {!opInfo ? (
              opInfoError
                ? <p className="py-2 text-label text-muted-foreground">{describeError(opInfoError).detail}</p>
                : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-5 w-full" />)
            ) : (
              <>
                <Row
                  label="Endpoint"
                  value={<span className="text-xs">{opInfo.url.replace(/^https?:\/\//, "")}</span>}
                  info="The Guardian you are currently connected to."
                />
                <Row
                  label="Network"
                  value={
                    <Badge className={`${networkColor(opInfo.network)} text-white`}>
                      {opInfo.network}
                    </Badge>
                  }
                  info="The Miden network this Guardian is operating on."
                />
                {/* No start time means no uptime to show: the row is dropped
                    rather than rendered as a dash next to a "since" line. */}
                {uptimeSecs !== null && (
                  <Row
                    label="Uptime"
                    value={formatUptime(uptimeSecs)}
                    sub={`since ${new Date(startedMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`}
                    info="Time elapsed since the Guardian process last started."
                  />
                )}

                {/* Version at bottom */}
                {build && (
                  <Row
                    label="Version"
                    value={<span className="text-muted-foreground font-mono text-xs">{build.version}</span>}
                    info="Guardian software version."
                  />
                )}

                {/* Expandable details: commit, Guardian settings and public key */}
                {hasDetails && (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="w-3 h-3 group-open:rotate-180" />
                      <span className="group-open:hidden">Show details</span>
                      <span className="hidden group-open:inline">Hide details</span>
                    </summary>
                    {build?.gitCommit && build.gitCommit !== "unknown" && (
                      <Row
                        label="Commit"
                        value={<CopyableId id={build.gitCommit} prefixLen={7} suffixLen={0} />}
                        info="Git commit SHA of the Guardian build currently running."
                      />
                    )}
                    {queueDepth !== undefined && (
                      <Row
                        label="Queue"
                        value={`${queueDepth} per account`}
                        info="How many submitted transactions one account can have waiting for the chain at once."
                      />
                    )}
                    {sessionTtl !== undefined && (
                      <Row
                        label="Sessions"
                        value={`up to ${formatUptime(sessionTtl)}`}
                        info="Longest a wallet session lasts before the wallet must approve again."
                      />
                    )}
                    {opInfo.publicKey && (
                      <Row
                        label="Public key"
                        value={<CopyableId id={opInfo.publicKey} prefixLen={8} />}
                        info="Your dashboard Falcon-512 public key as registered with this Guardian."
                      />
                    )}
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
