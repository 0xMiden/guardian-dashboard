import { Info } from "lucide-react";

// An icon rather than a 9px letter in a circle. 9px was the smallest type in
// the product by a wide margin and well under anything legible; drawing the
// glyph sidesteps the problem instead of shrinking text to fit a 14px circle.
//
// `title` carries the same text, so it survives for anyone not using a mouse:
// the hover-only tooltip was unreachable by keyboard or touch.
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group/tip inline-flex shrink-0">
      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" aria-label={text}>
        <title>{text}</title>
      </Info>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-lg bg-popover border text-popover-foreground text-xs p-2 shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity z-20 pointer-events-none">
        {text}
      </span>
    </span>
  );
}
