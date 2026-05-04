"use client";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import posthog from "posthog-js";

type Level = "ALL" | "INFO" | "WARN" | "ERROR";

// Rust tracing: "2024-01-15T10:30:45.123456Z  INFO crate::module: message key=val"
//           or: "2026-04-04 09:51:28.685882 INFO [module]: message"
const LINE_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+(\S+?):\s*(.*)/;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const KV_RE = /(\w[\w.]*=)([^\s,}]+)/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

type ParsedLine = {
  raw: string;
  ts: string;
  level: string;
  module: string;
  message: string;
} | null;

function parseLine(line: string): ParsedLine {
  const clean = stripAnsi(line);
  const m = clean.match(LINE_RE);
  if (!m) return null;
  return { raw: line, ts: m[1], level: m[2], module: m[3], message: stripAnsi(m[4]) };
}

function detectLevel(line: string): Level {
  const m = stripAnsi(line).match(LINE_RE);
  if (!m) return "INFO";
  if (m[2] === "ERROR") return "ERROR";
  if (m[2] === "WARN") return "WARN";
  return "INFO";
}

const levelBadge: Record<string, string> = {
  ERROR: "text-red-400 font-bold",
  WARN:  "text-amber-400 font-bold",
  INFO:  "text-emerald-400",
  DEBUG: "text-sky-400",
  TRACE: "text-zinc-500",
};

function MessageSpans({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  KV_RE.lastIndex = 0;
  while ((m = KV_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={last} className="text-zinc-200">{text.slice(last, m.index)}</span>);
    parts.push(<span key={m.index + "k"} className="text-violet-400">{m[1]}</span>);
    parts.push(<span key={m.index + "v"} className="text-cyan-300">{m[2]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={last} className="text-zinc-200">{text.slice(last)}</span>);
  return <>{parts}</>;
}

function LogLine({ line }: { line: string }) {
  const p = parseLine(line);
  if (!p) return <div className="leading-5 text-zinc-400">{stripAnsi(line)}</div>;
  return (
    <div className="leading-5 flex gap-2 min-w-0">
      <span className="shrink-0 text-zinc-600">{p.ts}</span>
      <span className={`shrink-0 w-12 text-right ${levelBadge[p.level] ?? "text-zinc-400"}`}>{p.level}</span>
      <span className="shrink-0 text-zinc-500 max-w-[220px] truncate">{p.module}:</span>
      <span className="min-w-0 break-all"><MessageSpans text={p.message} /></span>
    </div>
  );
}

export function LogViewer() {
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState<Level>("ALL");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/logs");
    es.onmessage = (e) => {
      const line: string = JSON.parse(e.data);
      setLines((prev) => [...prev.slice(-500), line]);
    };
    es.onerror = () => {
      setError("No log source available. Set DOCKER_CONTAINER_NAME (preferred) or LOG_FILE_PATH in your environment.");
      es.close();
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  const visible = lines.filter((l) => {
    if (filter !== "ALL" && detectLevel(l) !== filter) return false;
    if (search && !l.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", "INFO", "WARN", "ERROR"] as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => {
              posthog.capture("log_filter_changed", { filter_level: l });
              setFilter(l);
            }}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${filter === l ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {l}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto rounded border bg-background px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          onClick={() => setAutoScroll((a) => !a)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${autoScroll ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}
        >
          Auto-scroll {autoScroll ? "on" : "off"}
        </button>
      </div>

      {/* Log output */}
      <div className="h-[calc(100vh-220px)] overflow-y-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs">
        {visible.length === 0 && (
          <span className="text-muted-foreground">Waiting for log lines…</span>
        )}
        {visible.map((line, i) => <LogLine key={i} line={line} />)}
        <div ref={bottomRef} />
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {visible.length} of {lines.length} lines
      </div>
    </div>
  );
}
