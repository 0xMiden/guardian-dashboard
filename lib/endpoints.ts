export interface Endpoint {
  id: string;
  label: string;
  url: string;
  network: string;
  commitment: string;
  privateKey: string;
}

let cached: Endpoint[] | null = null;

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
  cached = JSON.parse(raw) as Endpoint[];
  return cached;
}

export function getEndpoint(id: string): Endpoint | undefined {
  return getEndpoints().find((e) => e.id === id);
}

export function getPublicEndpoints(): Pick<Endpoint, "id" | "label">[] {
  return getEndpoints().map(({ id, label }) => ({ id, label }));
}
