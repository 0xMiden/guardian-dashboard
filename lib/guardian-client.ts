import {
  GuardianOperatorHttpClient,
  GuardianOperatorHttpError,
  type ListAccountsOptions,
  type PaginationOptions,
  type GlobalDeltasOptions,
  type DeltaDetailOptions,
} from "@openzeppelin/guardian-operator-client";
import { signDigest } from "./falcon";
import { getEndpoint } from "./endpoints";

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ClientState {
  client: GuardianOperatorHttpClient;
  sessionCookie: string | null;
  authInFlight: Promise<void> | null;
  /** Minimum gap between node requests. 0 means this node has never limited us. */
  pacedIntervalMs: number;
  /** Earliest moment the next request may go out. */
  nextSlotAt: number;
}

const clients = new Map<string, ClientState>();

/**
 * Per-endpoint request pacing.
 *
 * Measured 2026-08-03: lambda and gateway each serve ~57 requests per 60s and
 * then answer 429 with `retry-after: 60`, which locks out EVERY route for a
 * full minute. That lockout is what operators experience as the dashboard
 * timing out when they click around. Paced at 50/min the same node served 100
 * of 100 requests with no 429 at all, so the limit is entirely avoidable by
 * spacing requests rather than bursting into them.
 *
 * OpenZeppelin has no limit and must not be slowed down, so pacing stays off
 * until a node proves it needs it: the first 429 from an endpoint turns it on
 * for that endpoint and it stays on for the life of the instance.
 *
 * 45/min rather than the 50 measured safe, because Vercel runs several
 * instances and each paces independently.
 *
 * // ponytail: per-instance, like the caches in lib/account-cache.ts. Known
 * // ceiling: N warm instances can still sum past the node's bucket. Upgrade
 * // path is a shared store; until then the 429 handling below is the backstop.
 */
const PACED_INTERVAL_MS = Math.ceil(60_000 / 45);

let pacedInterval = PACED_INTERVAL_MS;

/**
 * Test seam. Not used by application code. Clears the per-endpoint client
 * cache, and optionally shrinks the pacing interval so tests can exercise the
 * spacing without spending real seconds on it.
 */
export function __resetGuardianClients(pacedIntervalMs?: number): void {
  clients.clear();
  pacedInterval = pacedIntervalMs ?? PACED_INTERVAL_MS;
}

/** Take the next slot, waiting for it if this endpoint is paced. */
async function reserveSlot(state: ClientState): Promise<void> {
  if (!state.pacedIntervalMs) return;
  const now = Date.now();
  const at = Math.max(now, state.nextSlotAt);
  state.nextSlotAt = at + state.pacedIntervalMs;
  if (at > now) await sleep(at - now);
}

/**
 * Spend a slot without waiting for one. For the liveness ping: it has to count
 * against the node's budget, but a health check that queues behind a snapshot
 * burst would report "down" for a node that is perfectly fine.
 */
function chargeSlot(state: ClientState): void {
  if (!state.pacedIntervalMs) return;
  state.nextSlotAt = Math.max(Date.now(), state.nextSlotAt) + state.pacedIntervalMs;
}

function startPacing(state: ClientState): void {
  if (state.pacedIntervalMs) return;
  state.pacedIntervalMs = pacedInterval;
  state.nextSlotAt = Date.now();
}

function createClient(endpointId: string): ClientState {
  const ep = getEndpoint(endpointId);
  if (!ep) throw new Error(`Unknown endpoint: ${endpointId}`);
  const state: ClientState = {
    client: null as unknown as GuardianOperatorHttpClient,
    sessionCookie: null,
    authInFlight: null,
    pacedIntervalMs: 0,
    nextSlotAt: 0,
  };
  const authFetch: AuthFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (state.sessionCookie) headers.set("Cookie", state.sessionCookie);
    const res = await fetch(input, { ...init, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) state.sessionCookie = setCookie.split(";")[0];
    return res;
  };
  state.client = new GuardianOperatorHttpClient({ baseUrl: ep.url, fetch: authFetch });
  return state;
}

function getState(endpointId: string): ClientState {
  let state = clients.get(endpointId);
  if (!state) {
    state = createClient(endpointId);
    clients.set(endpointId, state);
  }
  return state;
}

function ensureAuthenticated(state: ClientState, endpointId: string): Promise<void> {
  if (state.sessionCookie) return Promise.resolve();
  // Single-flight: concurrent requests on a fresh instance share one
  // challenge/verify instead of each running their own handshake — the node
  // rate-limits per operator commitment, so extra handshakes burn the budget.
  if (!state.authInFlight) {
    state.authInFlight = (async () => {
      const ep = getEndpoint(endpointId)!;
      // The handshake is two more node requests, so it pays the same toll.
      await reserveSlot(state);
      const { challenge } = await state.client.challenge(ep.commitment);
      const signature = await signDigest(ep.privateKey, challenge.signingDigest);
      await reserveSlot(state);
      await state.client.verify({ commitment: ep.commitment, signature });
    })().finally(() => { state.authInFlight = null; });
  }
  return state.authInFlight;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_AFTER_SECS = 5;

async function withRetry<T>(state: ClientState, endpointId: string, fn: () => Promise<T>): Promise<T> {
  let reauthed = false;
  let rateLimitRetries = 0;
  while (true) {
    try {
      await ensureAuthenticated(state, endpointId);
      await reserveSlot(state);
      return await fn();
    } catch (err) {
      // Any 429 is the node telling us its real capacity. Pace every route from
      // here on, whether or not this particular call is worth retrying, so we
      // stop bursting into a lockout that takes the whole dashboard with it.
      if (err instanceof GuardianOperatorHttpError && err.status === 429) startPacing(state);

      if (err instanceof GuardianOperatorHttpError && err.status === 401 && !reauthed) {
        reauthed = true;
        state.sessionCookie = null;
        continue;
      }
      // The node rate-limits per operator commitment (429 + retry_after_secs);
      // honor it instead of failing the whole page load. When the node's
      // sustained limit asks for more than we're willing to wait (e.g. 60s),
      // fail fast — clients keep stale data and SWR retries later.
      if (
        err instanceof GuardianOperatorHttpError && err.status === 429 &&
        rateLimitRetries < MAX_RATE_LIMIT_RETRIES &&
        (err.retryAfterSecs ?? 1) <= MAX_RETRY_AFTER_SECS
      ) {
        rateLimitRetries++;
        await sleep((err.retryAfterSecs ?? 1) * 1000);
        continue;
      }
      throw err;
    }
  }
}

export function getGuardianClient(endpointId: string) {
  const state = getState(endpointId);
  return {
    /**
     * How far apart this node's requests are being spaced, 0 when unpaced. The
     * asset walk reads it to size a pass that still fits inside the serverless
     * invocation (see lib/account-cache.ts).
     */
    pacingIntervalMs() {
      return state.pacedIntervalMs;
    },
    async checkHealth() {
      const ep = getEndpoint(endpointId)!;
      const start = Date.now();
      // Charged, not queued: this is a 2s liveness ping, and one that waited its
      // turn behind a snapshot burst would report a healthy node as down.
      chargeSlot(state);
      try {
        const res = await fetch(`${ep.url.replace(/\/$/, "")}/pubkey`, { signal: AbortSignal.timeout(2000) });
        return { status: res.ok ? "up" : "down" as const, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      } catch {
        return { status: "down" as const, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      }
    },
    async listAccounts(options?: ListAccountsOptions) {
      return withRetry(state, endpointId, () => state.client.listAccounts(options));
    },
    async getDashboardInfo() {
      return withRetry(state, endpointId, () => state.client.getDashboardInfo());
    },
    async getAccount(accountId: string) {
      return withRetry(state, endpointId, () => state.client.getAccount(accountId));
    },
    async getAccountSnapshot(accountId: string) {
      return withRetry(state, endpointId, () => state.client.getAccountSnapshot(accountId));
    },
    async listAccountDeltas(accountId: string, options?: PaginationOptions) {
      return withRetry(state, endpointId, () => state.client.listAccountDeltas(accountId, options));
    },
    async listAccountProposals(accountId: string, options?: PaginationOptions) {
      return withRetry(state, endpointId, () => state.client.listAccountProposals(accountId, options));
    },
    async listGlobalDeltas(options?: GlobalDeltasOptions) {
      return withRetry(state, endpointId, () => state.client.listGlobalDeltas(options));
    },
    async listGlobalProposals(options?: PaginationOptions) {
      return withRetry(state, endpointId, () => state.client.listGlobalProposals(options));
    },
    async getAccountDeltaDetail(accountId: string, nonce: number, options?: DeltaDetailOptions) {
      return withRetry(state, endpointId, () => state.client.getAccountDeltaDetail(accountId, nonce, options));
    },
    async pauseAccount(accountId: string, reason: string) {
      return withRetry(state, endpointId, () => state.client.pauseAccount(accountId, reason));
    },
    async unpauseAccount(accountId: string, reason?: string) {
      return withRetry(state, endpointId, () => state.client.unpauseAccount(accountId, reason));
    },
  };
}

