"use client";

/**
 * A filter chip, shared so the tables cannot drift apart again.
 *
 * Accounts and Activity had grown two different chips: one filled its active
 * state and bordered every inactive one, the other outlined the active state
 * and left the rest borderless. Side by side they read as two products.
 *
 * The quiet version wins: with six filters on Activity, a border around each
 * inactive chip is six boxes competing with the table underneath.
 */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
