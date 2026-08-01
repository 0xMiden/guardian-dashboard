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
}

const clients = new Map<string, ClientState>();

function createClient(endpointId: string): ClientState {
  const ep = getEndpoint(endpointId);
  if (!ep) throw new Error(`Unknown endpoint: ${endpointId}`);
  const state: ClientState = {
    client: null as unknown as GuardianOperatorHttpClient,
    sessionCookie: null,
    authInFlight: null,
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
      const { challenge } = await state.client.challenge(ep.commitment);
      const signature = await signDigest(ep.privateKey, challenge.signingDigest);
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
      return await fn();
    } catch (err) {
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
    async checkHealth() {
      const ep = getEndpoint(endpointId)!;
      const start = Date.now();
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

