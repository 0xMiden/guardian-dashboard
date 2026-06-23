import {
  GuardianOperatorHttpClient,
  GuardianOperatorHttpError,
  GuardianOperatorContractError,
  type PaginationOptions,
  type GlobalDeltasOptions,
  type DashboardAccountSummary,
  type PagedResult,
  type DeltaDetailOptions,
} from "@openzeppelin/guardian-operator-client";
import { signDigest } from "./falcon";
import { getEndpoint, getEndpoints } from "./endpoints";

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ClientState {
  client: GuardianOperatorHttpClient;
  authFetch: AuthFetch;
  sessionCookie: string | null;
}

const clients = new Map<string, ClientState>();

function createClient(endpointId: string): ClientState {
  const ep = getEndpoint(endpointId);
  if (!ep) throw new Error(`Unknown endpoint: ${endpointId}`);
  const state: ClientState = {
    client: null as unknown as GuardianOperatorHttpClient,
    authFetch: null as unknown as AuthFetch,
    sessionCookie: null,
  };
  const authFetch: AuthFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (state.sessionCookie) headers.set("Cookie", state.sessionCookie);
    const res = await fetch(input, { ...init, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) state.sessionCookie = setCookie.split(";")[0];
    return res;
  };
  state.authFetch = authFetch;
  state.client = new GuardianOperatorHttpClient({ baseUrl: ep.url, fetch: authFetch });
  return state;
}

// Old-server (pre-v0.14.6) accounts format: { success, total_count, accounts: [...] }
async function listAccountsLegacy(
  state: ClientState,
  ep: NonNullable<ReturnType<typeof getEndpoint>>,
  options: PaginationOptions = {},
): Promise<PagedResult<DashboardAccountSummary>> {
  const base = ep.url.endsWith("/") ? ep.url : `${ep.url}/`;
  const url = new URL("dashboard/accounts", base);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  const res = await state.authFetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`listAccounts failed: ${res.status}`);
  const body = await res.json() as { accounts?: Record<string, unknown>[] };
  return {
    items: (body.accounts ?? []).map((a) => ({
      accountId: a["account_id"] as string,
      authScheme: a["auth_scheme"] as string,
      authorizedSignerCount: a["authorized_signer_count"] as number,
      hasPendingCandidate: a["has_pending_candidate"] as boolean,
      currentCommitment: a["current_commitment"] as string | null,
      stateStatus: a["state_status"] as "available" | "unavailable",
      createdAt: a["created_at"] as string,
      updatedAt: a["updated_at"] as string,
      pausedAt: null,
      pausedReason: null,
    })),
    nextCursor: null,
  };
}

function getState(endpointId: string): ClientState {
  let state = clients.get(endpointId);
  if (!state) {
    state = createClient(endpointId);
    clients.set(endpointId, state);
  }
  return state;
}

async function ensureAuthenticated(state: ClientState, endpointId: string): Promise<void> {
  if (state.sessionCookie) return;
  const ep = getEndpoint(endpointId)!;
  const { challenge } = await state.client.challenge(ep.commitment);
  const signature = await signDigest(ep.privateKey, challenge.signingDigest);
  await state.client.verify({ commitment: ep.commitment, signature });
}

async function withReauth<T>(state: ClientState, endpointId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GuardianOperatorHttpError && err.status === 401) {
      state.sessionCookie = null;
      await ensureAuthenticated(state, endpointId);
      return fn();
    }
    throw err;
  }
}

export function getGuardianClient(endpointId: string) {
  const state = getState(endpointId);
  return {
    async checkHealth() {
      const ep = getEndpoint(endpointId)!;
      const base = ep.url.replace(/\/$/, "");
      const start = Date.now();
      try {
        const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2000) });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          const up = (await res.json() as { status: string }).status === "ok";
          return { status: up ? "up" : "down" as const, latencyMs, checkedAt: new Date().toISOString() };
        }
        // /status not yet deployed — fall back to /pubkey
        const t = Date.now();
        const r2 = await fetch(`${base}/pubkey`, { signal: AbortSignal.timeout(2000) });
        return { status: r2.ok ? "up" : "down" as const, latencyMs: Date.now() - t, checkedAt: new Date().toISOString() };
      } catch {
        return { status: "down" as const, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      }
    },
    async listAccounts(options?: PaginationOptions) {
      await ensureAuthenticated(state, endpointId);
      try {
        return await withReauth(state, endpointId, () => state.client.listAccounts(options));
      } catch (err) {
        if (!(err instanceof GuardianOperatorContractError)) throw err;
        return listAccountsLegacy(state, getEndpoint(endpointId)!, options);
      }
    },
    async getDashboardInfo() {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.getDashboardInfo());
    },
    async getAccount(accountId: string) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.getAccount(accountId));
    },
    async getAccountSnapshot(accountId: string) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.getAccountSnapshot(accountId));
    },
    async listAccountDeltas(accountId: string, options?: PaginationOptions) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.listAccountDeltas(accountId, options));
    },
    async listAccountProposals(accountId: string, options?: PaginationOptions) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.listAccountProposals(accountId, options));
    },
    async listGlobalDeltas(options?: GlobalDeltasOptions) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.listGlobalDeltas(options));
    },
    async listGlobalProposals(options?: PaginationOptions) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.listGlobalProposals(options));
    },
    async getAccountDeltaDetail(accountId: string, nonce: number, options?: DeltaDetailOptions) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.getAccountDeltaDetail(accountId, nonce, options));
    },
    async pauseAccount(accountId: string, reason: string) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.pauseAccount(accountId, reason));
    },
    async unpauseAccount(accountId: string, reason?: string) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.unpauseAccount(accountId, reason));
    },
  };
}

function firstEndpointId(): string {
  const ep = getEndpoints()[0];
  if (!ep) throw new Error("No Guardian endpoints configured");
  return ep.id;
}

// Legacy single-endpoint helpers for backward compatibility
export function checkHealth() { return getGuardianClient(firstEndpointId()).checkHealth(); }
export function listAccounts() { return getGuardianClient(firstEndpointId()).listAccounts(); }
export function getAccount(accountId: string) { return getGuardianClient(firstEndpointId()).getAccount(accountId); }
