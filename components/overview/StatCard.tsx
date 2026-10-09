"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/InfoTip";
import { describeError } from "@/components/ui/ErrorPanel";
import { formatCount } from "@/lib/format";

/**
 * One Overview figure: a label with its definition on hover, the figure, an
 * optional line under it, and an optional breakdown behind a chevron. Every
 * card on the page is one of these, so they cannot drift apart.
 */
export function StatCard({
  icon,
  label,
  info,
  children,
  sub,
  details,
  attention = false,
}: {
  icon?: React.ReactNode;
  label: string;
  info: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  details?: React.ReactNode;
  /** The figure wants an operator, and takes Frozen's tone. */
  attention?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1 flex items-center gap-1.5 text-label text-muted-foreground">
              {icon}
              {label}
              <InfoTip text={info} />
            </p>
            <div className={`text-stat ${attention ? "text-state-frozen" : ""}`}>{children}</div>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          {details && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-muted-foreground transition-colors hover:text-foreground"
              title={open ? "Collapse" : "Expand"}
              aria-label={open ? "Collapse" : "Expand"}
              aria-expanded={open}
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
        {open && details && <div className="mt-3 space-y-1.5 border-t pt-3">{details}</div>}
      </CardContent>
    </Card>
  );
}

/** A line of a card's breakdown. */
export function StatRow({ label, value, title, accent }: { label: string; value: React.ReactNode; title?: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground" title={title}>{label}</span>
      <span className={`font-medium ${accent ?? ""}`}>{typeof value === "number" ? formatCount(value) : value}</span>
    </div>
  );
}

/**
 * A figure that is not there, muted, with the reason on hover when there is
 * one. Absence is muted everywhere on the page; a value is not.
 */
export function Absent({ children = "—", error, title }: { children?: React.ReactNode; error?: unknown; title?: string }) {
  return (
    <span className="text-muted-foreground" title={error ? describeError(error).detail : title}>
      {children}
    </span>
  );
}
