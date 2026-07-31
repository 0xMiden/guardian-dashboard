"use client";
import { Search, X } from "lucide-react";

/**
 * Account ID filter for the tables that list accounts or activity.
 *
 * // ponytail: filters the rows already loaded. The node has no search
 * // parameter (`ListAccountsOptions` is limit/cursor/paused), so a server-side
 * // filter would mean paging the whole inventory on every keystroke. Upgrade
 * // path is a search parameter on the node's list endpoints; until then the
 * // Accounts table offers a direct open for an ID that is not loaded yet.
 */
export function AccountIdFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter by account ID"
        aria-label="Filter by account ID"
        className="w-52 rounded-full border bg-transparent py-1 pl-7 pr-6 text-xs placeholder:text-muted-foreground focus:border-ring focus:outline-none"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear filter"
          className="absolute right-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
