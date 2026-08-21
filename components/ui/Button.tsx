"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The bordered secondary button, shared.
 *
 * There were twelve of these, copy-pasted and drifted: only six of the fifteen
 * bordered controls carried the hover border, a couple had a focus ring, the
 * radius alternated between lg and md, and the padding was whatever the last
 * person typed. Replacing the colour alone would have preserved all of that,
 * so the button itself is the fix.
 *
 * Everything here is on tokens, which is what lets the whole app change theme
 * from one place.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors " +
    "hover:text-foreground hover:border-foreground/30 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
    "disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        // Quiet by default: these sit beside tables and must not compete.
        secondary: "border-border text-muted-foreground",
        // Filled, for the one action a screen is actually about.
        primary: "border-transparent bg-primary text-primary-foreground hover:brightness-110 hover:text-primary-foreground",
      },
      size: {
        sm: "px-2 py-1 text-label",
        md: "px-3 py-1.5 text-data",
        lg: "px-4 py-2 text-data",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

