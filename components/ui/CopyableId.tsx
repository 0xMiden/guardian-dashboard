"use client";
import { useState } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { truncateId } from "@/lib/format";

interface Props {
  id: string;
  /**
   * Renders the id as a link. Rows that navigate on click need this: a bare
   * `onClick` on the `<tr>` cannot be cmd-clicked, middle-clicked, copied as a
   * link address or reached by keyboard, and cmd-click on such a row navigates
   * the current tab as well as opening the new one.
   */
  href?: string;
  onNavigate?: () => void;
  prefixLen?: number;
  suffixLen?: number;
  className?: string;
}

export function CopyableId({ id, href, onNavigate, prefixLen = 10, suffixLen = 6, className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const display = truncateId(id, prefixLen, suffixLen);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className={`inline-flex items-center gap-1 group ${className}`}>
      {href ? (
        <Link
          href={href}
          // Prefetch is off deliberately. Next prefetches every link in view, and
          // a table row's link points at an account page that reads from the
          // Guardian, so a scroll down a 1,400-row list would spend the
          // Guardian's request budget on pages nobody opened. The same budget is why
          // this table fetches asset totals per visible row.
          prefetch={false}
          // The row handler navigates too, so letting this bubble would push the
          // same route twice and leave a duplicate history entry.
          onClick={(e) => { e.stopPropagation(); onNavigate?.(); }}
          className="font-mono text-xs rounded-lg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={id}
        >
          {display}
        </Link>
      ) : (
        <span className="font-mono text-xs" title={id}>{display}</span>
      )}
      <button
        onClick={copy}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground"
        title={id}
      >
        {copied
          ? <Check className="h-3 w-3 text-state-active" />
          : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
