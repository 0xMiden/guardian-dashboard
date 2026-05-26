"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { truncateId } from "@/lib/format";

interface Props {
  id: string;
  prefixLen?: number;
  suffixLen?: number;
  className?: string;
}

export function CopyableId({ id, prefixLen = 10, suffixLen = 6, className = "" }: Props) {
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
      <span className="font-mono text-xs" title={id}>{display}</span>
      <button
        onClick={copy}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground"
        title={id}
      >
        {copied
          ? <Check className="h-3 w-3 text-emerald-400" />
          : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}
