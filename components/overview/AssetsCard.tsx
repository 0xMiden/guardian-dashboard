"use client";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { StatCard, StatRow, Absent } from "@/components/overview/StatCard";

type AssetTotals = {
  usd?: number | null;
  /** The Guardian has not published its first aggregate since starting up. */
  warming?: boolean;
  /** The Guardian predates `GET /dashboard/stats`, which shipped in 0.18.0. */
  unsupported?: boolean;
  done?: number;
  total?: number;
  /** Faucets the vaults hold, split by whether anything prices them. */
  priced?: number;
  unpriced?: number;
};

export function AssetsCard() {
  // One request per poll, answered from an aggregate the Guardian refreshes on its own cadence.
  const { data, error } = useSWR<AssetTotals>("/api/accounts/asset-totals", fetcher, { refreshInterval: 60_000 });
  const split = data?.priced != null && data.unpriced != null;

  return (
    <StatCard
      label="Assets"
      info="Dollar value of everything the accounts on this Guardian hold, for tokens on the verified token list with a market price. Anything else is unpriced."
      details={split && (
        <>
          <StatRow label="Priced tokens" value={data.priced!} />
          <StatRow label="Unpriced tokens" value={data.unpriced!} />
        </>
      )}
    >
      {!data && !error ? (
        <Skeleton className="mt-1 h-8 w-20" />
      ) : data?.usd != null ? (
        `$${data.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ) : data?.unsupported ? (
        // Nothing here changes until this Guardian's operator upgrades.
        <Absent title="This Guardian computes no cross-account totals. The endpoint the dashboard reads them from arrived in Guardian 0.18.0.">
          <span className="text-section">Needs Guardian 0.18.0</span>
        </Absent>
      ) : data?.unpriced && !data.priced ? (
        // Holdings exist and none has a market: a test mint or an unlisted
        // token gets no dollar figure rather than an invented one (lib/prices.ts).
        <Absent title={`Holdings in ${formatCount(data.unpriced)} token(s) with no price: not on the verified token list, or the price feed is unreachable. The Miden wallet shows the same holdings with no dollar figure.`}>
          <span className="text-section">Unpriced</span>
        </Absent>
      ) : data?.warming ? (
        // The number climbing is the only evidence that waiting will end.
        <Absent title="The Guardian is still computing its first asset aggregate. This clears within one refresh interval.">
          <span className="text-section">
            Calculating…
            {data.done != null && data.total != null && (
              <span className="ml-1 text-data">{formatCount(data.done)} of {formatCount(data.total)}</span>
            )}
          </span>
        </Absent>
      ) : (
        <Absent error={error} />
      )}
    </StatCard>
  );
}
