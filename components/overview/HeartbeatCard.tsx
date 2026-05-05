"use client";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthData {
  status: "up" | "down";
  latencyMs: number;
  checkedAt: string;
}

export function HeartbeatCard() {
  const [history, setHistory] = useState<{ t: number; ms: number }[]>([]);
  const { data } = useSWR<HealthData>("/api/health", fetcher, {
    refreshInterval: 5000,
    onSuccess: (d) => setHistory((prev) => [...prev.slice(-19), { t: Date.now(), ms: d.latencyMs }]),
  });
  const { data: opInfo } = useSWR<{ url: string }>("/api/operator-info", fetcher);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Heartbeat</CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-10 w-32" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Badge variant={data.status === "up" ? "default" : "destructive"} className={data.status === "up" ? "bg-emerald-500" : ""}>
                {data.status === "up" ? "Online" : "Offline"}
              </Badge>
              <span className="text-2xl font-bold">{data.latencyMs}ms</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Last checked {new Date(data.checkedAt).toLocaleTimeString()}
            </p>
            {opInfo && (
              <p className="mt-0.5 text-xs text-zinc-600 truncate">
                {opInfo.url.replace(/^https?:\/\//, "")}
              </p>
            )}
          </>
        )}
        {history.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
