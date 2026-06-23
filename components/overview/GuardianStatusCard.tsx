"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthData {
  status: "up" | "down";
  latencyMs: number;
  checkedAt: string;
}

interface OverviewData {
  environment?: string;
  build?: { version: string; gitCommit: string; startedAt: string; profile: string };
  error?: string;
}

interface OperatorInfo {
  url: string;
  network: string;
  commitment: string | null;
}

const networkColor: Record<string, string> = {
  MidenLocal: "bg-zinc-500",
  MidenDevnet: "bg-blue-500",
  MidenTestnet: "bg-amber-500",
  MidenMainnet: "bg-emerald-500",
};

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function truncate(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

function CopyableHash({ value, short }: { value: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const display = short ? value.slice(0, 7) : truncate(value);
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
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded bg-popover border text-popover-foreground text-xs p-2 shadow-md opacity-0 group-hover/tip:opacity-100 transition-opacity z-20 pointer-events-none">
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

let cachedHistory: { t: number; ms: number }[] = [];

export function GuardianStatusCard() {
  const [history, setHistory] = useState<{ t: number; ms: number }[]>(cachedHistory);
  const [showDetails, setShowDetails] = useState(false);

  const { data: health } = useSWR<HealthData>("/api/health", fetcher, {
    refreshInterval: 5000,
    onSuccess: (d) => setHistory((prev) => {
      const next = [...prev.slice(-19), { t: Date.now(), ms: d.latencyMs }];
      cachedHistory = next;
      return next;
    }),
  });

  const { data: overview } = useSWR<OverviewData>("/api/overview", fetcher, {
    refreshInterval: 30_000,
  });

  const { data: opInfo } = useSWR<OperatorInfo>("/api/operator-info", fetcher);

  const isUp = health?.status === "up";
  const build = overview?.build;
  const hasDetails = !!(build?.gitCommit && build.gitCommit !== "unknown") || !!opInfo?.commitment;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Guardian Node</CardTitle>
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
                    className={isUp ? "bg-emerald-500" : ""}
                  >
                    {isUp ? "Online" : "Offline"}
                  </Badge>
                  <span className="text-2xl font-bold">{health.latencyMs}ms</span>
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
                    <Line type="monotone" dataKey="ms" stroke="#8b5cf6" dot={false} strokeWidth={2} />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="rounded bg-background px-2 py-1 text-xs shadow border">
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
                    <Badge className={`${networkColor[opInfo.network] ?? "bg-zinc-500"} text-white`}>
                      {opInfo.network}
                    </Badge>
                  }
                  info="The Miden network this Guardian node is operating on."
                />
                {build && (
                  <Row
                    label="Uptime"
                    value={formatUptime(Math.floor((Date.now() - new Date(build.startedAt).getTime()) / 1000))}
                    sub={`since ${new Date(build.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`}
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
                        {opInfo.commitment && (
                          <Row
                            label="Commitment"
                            value={<CopyableHash value={opInfo.commitment} />}
                            info="Your operator public key commitment, used for Falcon-512 authentication with this Guardian node. Click to copy."
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
