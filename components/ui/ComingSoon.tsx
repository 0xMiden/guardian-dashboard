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

interface ModalProps {
  description?: string;
  onClose: () => void;
}

export function ComingSoonModal({ description, onClose }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-6 text-center shadow-2xl max-w-sm w-full mx-4">
        <Construction className="h-6 w-6 text-zinc-400" />
        <span className="rounded border border-violet-500/60 bg-violet-500/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-widest text-violet-400">
          Coming Soon
        </span>
        {description && (
          <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
        )}
        <button
          onClick={onClose}
          className="mt-1 px-4 py-1.5 text-sm rounded-lg border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
