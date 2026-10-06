import { GuardianOperatorHttpError } from "@openzeppelin/guardian-operator-client";
import type { DashboardStatsOptions, DashboardStatsResponse } from "@openzeppelin/guardian-operator-client";

/**
 * `GET /dashboard/stats` and its two degraded answers.
 *
 * This endpoint (issue #371) shipped in Guardian 0.18.0 and replaced what used
 * to be a paged walk of the whole account list plus one vault snapshot per
 * active account: 1,076 requests and 36s on the OZ Guardian at 7,198 accounts,
 * per cold serverless instance. It is one request, and the server answers from
 * a snapshot it refreshes on its own schedule.
 *
 * Two of its answers are not errors and must not reach the user as a dead
 * Guardian, because both say "no numbers yet" for reasons that have nothing to
 * do with reachability:
 *
 *   - `unsupported`: the server predates the endpoint and 404s it. Permanent
 *     until its operator upgrades. Measured 2026-10-06, openzeppelin (23,303
 *     accounts) and koda are still on 0.17.0.
 *   - `warming`: a 0.18.0 server that has not published its first snapshot
 *     since starting up. Documented as `data_unavailable` (503, retryable) and
 *     resolves within one refresh interval.
 *
 * Anything else is a real failure and is rethrown for `guardianRoute` to map.
 */
export type StatsOutcome =
  | { kind: "ok"; stats: DashboardStatsResponse }
  | { kind: "unsupported" }
  | { kind: "warming" };

export type StatsReader = {
  getDashboardStats(options?: DashboardStatsOptions): Promise<DashboardStatsResponse>;
};

export async function readStats(client: StatsReader, options?: DashboardStatsOptions): Promise<StatsOutcome> {
  try {
    return { kind: "ok", stats: await client.getDashboardStats(options) };
  } catch (err) {
    if (err instanceof GuardianOperatorHttpError) {
      if (err.status === 404) return { kind: "unsupported" };
      if (err.data?.code === "data_unavailable") return { kind: "warming" };
    }
    throw err;
  }
}

/**
 * How many of these accounts the dashboard calls wallets.
 *
 * `isWalletAccount` (lib/format.ts) reads the per-account `authScheme` and
 * `authorizedSignerCount` off the list endpoint. The aggregate groups by
 * `(authMethod, authorizedSignerCount)` for exactly this purpose ("lets a
 * consumer reproduce its own account-shape heuristics"), labelling the same
 * scheme `miden_ecdsa`. Verified equal on openzeppelin_devnet 2026-10-06: 218
 * wallets of 270 accounts, both ways.
 */
export function walletCount(stats: DashboardStatsResponse): number {
  return stats.accounts.byAuthMethodAndSignerCount
    .filter((row) => row.authMethod === "miden_ecdsa" && row.authorizedSignerCount === 2)
    .reduce((n, row) => n + row.count, 0);
}
