"use client";
import { useSyncExternalStore } from "react";
import { formatTimestamp, relativeTime } from "@/lib/format";

// Hoisted so a full page of rows shares one set of callbacks. Nothing ever
// notifies: the only transition is server snapshot -> client snapshot, which
// React performs once, at hydration.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * A timestamp that reads as "2h ago" and can still be pinned down exactly, by
 * hovering for the absolute form with its timezone.
 *
 * Relative time is derived from the clock, so rendering it on the server would
 * emit markup the client disagrees with the instant it hydrates. This is what
 * `useSyncExternalStore`'s server snapshot is for: the absolute form is what
 * gets rendered and hydrated, and React swaps in the relative one afterwards.
 * A row mounted later, which is every row in these tables, skips straight to
 * the relative form.
 *
 * Nothing ticks. SWR already re-renders these panels every 30s, which is finer
 * than the granularity the label shows, and a per-row interval across a full
 * 500-row page would cost more than it buys.
 */
export function Timestamp({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);

  const absolute = formatTimestamp(iso);
  const relative = hydrated ? relativeTime(iso) : null;

  return (
    <time dateTime={iso} title={absolute} className={className}>
      {relative ?? absolute}
    </time>
  );
}
