import {
  GuardianOperatorHttpClient,
  GuardianOperatorHttpError,
} from "@openzeppelin/guardian-operator-client";
import { signDigest } from "./falcon";
import { getEndpoint, getEndpoints } from "./endpoints";

interface ClientState {
  client: GuardianOperatorHttpClient;
  sessionCookie: string | null;
}

const clients = new Map<string, ClientState>();

function createClient(endpointId: string): ClientState {
  const ep = getEndpoint(endpointId);
  if (!ep) throw new Error(`Unknown endpoint: ${endpointId}`);
  const state: ClientState = { client: null as unknown as GuardianOperatorHttpClient, sessionCookie: null };
  state.client = new GuardianOperatorHttpClient({
    baseUrl: ep.url,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (state.sessionCookie) headers.set("Cookie", state.sessionCookie);
      const res = await fetch(input, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) state.sessionCookie = setCookie.split(";")[0];
      return res;
    },
  });
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
      const start = Date.now();
      try {
        const res = await fetch(`${ep.url}/pubkey`, { signal: AbortSignal.timeout(2000) });
        return { status: res.ok ? "up" : "down" as const, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      } catch {
        return { status: "down" as const, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      }
    },
    async listAccounts() {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.listAccounts());
    },
    async getAccount(accountId: string) {
      await ensureAuthenticated(state, endpointId);
      return withReauth(state, endpointId, () => state.client.getAccount(accountId));
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
