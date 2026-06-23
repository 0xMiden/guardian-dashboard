"use client";
import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthData {
  status: "up" | "down";
  latencyMs: number;
  checkedAt: string;
}

interface GuardianStatus {
  status: string;
  version: string;
  environment: string;
  uptime_secs: number;
  started_at: string;
  git_commit: string;
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

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right">
        {value}
        {sub && <span className="block text-xs text-muted-foreground font-normal">{sub}</span>}
      </span>
    </div>
  );
}

let cachedHistory: { t: number; ms: number }[] = [];

export function GuardianStatusCard() {
  const [history, setHistory] = useState<{ t: number; ms: number }[]>(cachedHistory);

  const { data: health } = useSWR<HealthData>("/api/health", fetcher, {
    refreshInterval: 5000,
    onSuccess: (d) => setHistory((prev) => {
      const next = [...prev.slice(-19), { t: Date.now(), ms: d.latencyMs }];
      cachedHistory = next;
      return next;
    }),
  });

  const { data: status } = useSWR<GuardianStatus>("/api/status", fetcher, {
    refreshInterval: 30_000,
  });

  const { data: opInfo } = useSWR<OperatorInfo>("/api/operator-info", fetcher);

  const isUp = health?.status === "up";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Guardian Node</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 md:flex-row md:gap-8">
          {/* Left: heartbeat */}
          <div className="w-full md:w-48 shrink-0 min-w-0">
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
            <div className="mt-3 h-12 w-full">
              {history.length > 1 && (
                <ResponsiveContainer width="100%" height={48} minWidth={0}>
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
          <div className="flex-1 divide-y">
            {!opInfo ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-5 w-full" />)
            ) : (
              <>
                <Row
                  label="Endpoint"
                  value={<span className="text-xs">{opInfo.url.replace(/^https?:\/\//, "")}</span>}
                />
                <Row
                  label="Network"
                  value={
                    <Badge className={`${networkColor[opInfo.network] ?? "bg-zinc-500"} text-white`}>
                      {opInfo.network}
                    </Badge>
                  }
                />
                {status && !status.error && (
                  <>
                    <Row label="Version" value={status.version} />
                    <Row
                      label="Uptime"
                      value={formatUptime(status.uptime_secs)}
                      sub={`since ${new Date(status.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`}
                    />
                    {status.git_commit && (
                      <Row
                        label="Commit"
                        value={<CopyableHash value={status.git_commit} short />}
                      />
                    )}
                  </>
                )}
                {opInfo.commitment && (
                  <Row
                    label="Commitment"
                    value={<CopyableHash value={opInfo.commitment} />}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
