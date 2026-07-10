"use client";
import { Construction } from "lucide-react";

function Card({ description }: { description?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/90 px-8 py-6 text-center shadow-xl backdrop-blur-sm">
      <Construction className="h-6 w-6 text-zinc-400" />
      <span className="rounded border border-violet-500/60 bg-violet-500/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-widest text-violet-400">
        Coming Soon
      </span>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
      )}
    </div>
  );
}

interface OverlayProps {
  description?: string;
  children?: React.ReactNode;
}

export function ComingSoon({ description, children }: OverlayProps) {
  return (
    <div className="relative">
      {children && (
        <div className="pointer-events-none select-none blur-sm opacity-30" aria-hidden>
          {children}
        </div>
      )}
      <div
        className={
          children
            ? "absolute inset-0 flex items-center justify-center"
            : "flex items-center justify-center py-24"
        }
      >
        <Card description={description} />
      </div>
    </div>
  );
}
