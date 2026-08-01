"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { truncateId } from "@/lib/format";

interface HealthData {
  status: "up" | "down";
  latencyMs: number;
  checkedAt: string;
}

interface OverviewData {
  environment?: string;
  build?: { version: string; gitCommit: string; startedAt: string; profile: string };
}

interface OperatorInfo {
  url: string;
  network: string;
  publicKey: string | null;
}

// The network is a label, not a state, so it no longer borrows status hues.
// MidenTestnet was amber, which also meant "submitted" and "pending" elsewhere.
// Mainnet keeps a tint, because which chain you are pointed at is worth a
// glance before an irreversible action.
const networkColor: Record<string, string> = {
  MidenLocal: "bg-state-neutral",
  MidenDevnet: "bg-state-neutral",
  MidenTestnet: "bg-state-neutral",
  MidenMainnet: "bg-state-active",
};

type LatencySample = { t: number; ms: number };

/**
 * Latency samples survive leaving the Overview tab, because the card is
 * unmounted on every navigation and a fresh chart needs two polls (10s) before
 * it can draw a line at all.
 *
 * Keyed by endpoint URL, which is the part that matters: an earlier version kept
 * these in a module-level array and plotted one Guardian node's latency as
 * another's after switching endpoints. sessionStorage also scopes them to the
 * tab, so two tabs on different nodes cannot contaminate each other.
 *
 * // ponytail: sessionStorage, so history is per tab and gone when it closes.
 * // Fine for a live latency sparkline; a real retention window would need the
 * // node to serve its own health history.
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

function CopyableHash({ value, short }: { value: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    // execCommand runs synchronously inside the click handler (user gesture intact)
    try {
      const el = Object.assign(document.createElement("textarea"), {
        value,
        style: "position:fixed;top:0;left:0;opacity:0;pointer-events:none",
      });
      document.body.appendChild(el);
      el.focus();
      el.select();
      if (document.execCommand("copy")) { document.body.removeChild(el); flash(); return; }
      document.body.removeChild(el);
    } catch { /* fall through */ }
    // Clipboard API fallback (async, requires secure context)
    navigator.clipboard?.writeText(value).then(flash).catch(() => {});
  }
  const display = short ? value.slice(0, 7) : truncateId(value, 8, 6);
  return (
    <button onClick={copy} title={value} className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors">
      {copied ? "copied!" : display}
    </button>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex shrink-0">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted text-[9px] leading-none text-muted-foreground cursor-help select-none">
        i
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-popover border text-popover-foreground text-xs p-2 shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity z-20 pointer-events-none">
        {text}
      </span>
    </span>
  );
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
  const [showDetails, setShowDetails] = useState(false);

  const { data: opInfo } = useSWR<OperatorInfo>("/api/operator-info", fetcher);
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

  const { data: health } = useSWR<HealthData>("/api/health", fetcher, {
    refreshInterval: 5000,
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

  // Uptime is derived from the two timestamps the polls already carry, rather
  // than from state set in `onSuccess`. A cache read fires no success callback,
  // so leaving the Overview tab and coming straight back was enough to leave
  // this reading "—" under a "since ..." line that was clearly populated.
  // `checkedAt` is the clock: it arrives as data, so this stays a pure function
  // of what the node reported and still advances with every 5s poll.
  const startedMs = build?.startedAt ? new Date(build.startedAt).getTime() : NaN;
  const checkedMs = health ? new Date(health.checkedAt).getTime() : NaN;
  const uptimeSecs = Number.isFinite(startedMs) && Number.isFinite(checkedMs)
    ? Math.max(0, Math.floor((checkedMs - startedMs) / 1000))
    : null;
  const hasDetails = !!(build?.gitCommit && build.gitCommit !== "unknown") || !!opInfo?.publicKey;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-section text-muted-foreground">Guardian Server</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: heartbeat + sparkline */}
          <div className="min-w-0">
            {!health ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={isUp ? "default" : "destructive"}
                    className={isUp ? "bg-state-active" : ""}
                  >
                    {isUp ? "Online" : "Offline"}
                  </Badge>
                  <span className="text-title">{formatCount(health.latencyMs)}ms</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last checked {new Date(health.checkedAt).toLocaleTimeString()}
                </p>
              </>
            )}
            <div className="mt-3 h-32 w-full">
              {history.length > 1 && (
                <ResponsiveContainer width="100%" height={128} minWidth={0}>
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
              )}
            </div>
          </div>

          {/* Right: info rows */}
          <div className="divide-y">
            {!opInfo ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-5 w-full" />)
            ) : (
              <>
                <Row
                  label="Endpoint"
                  value={<span className="text-xs">{opInfo.url.replace(/^https?:\/\//, "")}</span>}
                  info="The Guardian node you are currently connected to."
                />
                <Row
                  label="Network"
                  value={
                    <Badge className={`${networkColor[opInfo.network] ?? "bg-state-neutral"} text-white`}>
                      {opInfo.network}
                    </Badge>
                  }
                  info="The Miden network this Guardian node is operating on."
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
                    info="Guardian server software version."
                  />
                )}

                {/* Expandable details: Commit + Commitment */}
                {hasDetails && (
                  <>
                    <button
                      onClick={() => setShowDetails((v) => !v)}
                      className="flex items-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                      {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showDetails ? "Hide details" : "Show details"}
                    </button>
                    {showDetails && (
                      <>
                        {build?.gitCommit && build.gitCommit !== "unknown" && (
                          <Row
                            label="Commit"
                            value={<CopyableHash value={build.gitCommit} short />}
                            info="Git commit SHA of the Guardian build currently running. Click to copy the full hash."
                          />
                        )}
                        {opInfo.publicKey && (
                          <Row
                            label="Public key"
                            value={<CopyableHash value={opInfo.publicKey} />}
                            info="Your dashboard Falcon-512 public key as registered with this Guardian node. Click to copy."
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
