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
  if (!raw) return (cached = []);
  let parsed: Endpoint[];
  try {
    parsed = JSON.parse(raw) as Endpoint[];
  } catch {
    throw new Error("GUARDIAN_ENDPOINTS is not valid JSON. Check your environment configuration.");
  }
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
