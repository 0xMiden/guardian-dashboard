export interface Endpoint {
  id: string;
  label: string;
  url: string;
  network: string;
  commitment: string;
  privateKey: string;
}

let cached: Endpoint[] | null = null;

function privateKeyEnvVar(id: string): string {
  return `GUARDIAN_PRIVATE_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function getEndpoints(): Endpoint[] {
  if (cached) return cached;
  const raw = process.env.GUARDIAN_ENDPOINTS;
  if (!raw) {
    // Backward-compat: fall back to single-endpoint env vars
    const url = process.env.GUARDIAN_URL;
    const commitment = process.env.GUARDIAN_OPERATOR_COMMITMENT;
    const privateKey = process.env.GUARDIAN_OPERATOR_PRIVATE_KEY;
    if (url && commitment && privateKey) {
      cached = [{
        id: "__legacy__",
        label: process.env.GUARDIAN_NETWORK ?? "Guardian",
        url,
        network: process.env.GUARDIAN_NETWORK ?? "Unknown",
        commitment,
        privateKey,
      }];
    } else {
      cached = [];
    }
    return cached;
  }
  const parsed = JSON.parse(raw) as Endpoint[];
  // Private keys may be omitted from GUARDIAN_ENDPOINTS (to stay under Vercel's
  // 4KB env var limit) and supplied via GUARDIAN_PRIVATE_KEY_{ID} instead.
  cached = parsed.map((ep) => ({
    ...ep,
    privateKey: ep.privateKey || process.env[privateKeyEnvVar(ep.id)] || "",
  }));
  return cached;
}

export function getEndpoint(id: string): Endpoint | undefined {
  return getEndpoints().find((e) => e.id === id);
}

export function getPublicEndpoints(): Pick<Endpoint, "id" | "label">[] {
  return getEndpoints().map(({ id, label }) => ({ id, label }));
}
