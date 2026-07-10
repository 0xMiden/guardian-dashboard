import { createHmac, timingSafeEqual } from "crypto";

// The cockpit-endpoint cookie is HMAC-signed and bound to the Clerk user id,
// so a signed-in user can't hand-craft a cookie for an endpoint they were
// never granted (authorization is checked once, in POST /api/select-endpoint;
// the middleware then only has to verify the signature).
// ponytail: revoking a user's endpoint access doesn't invalidate an already
// issued cookie — upgrade path is re-checking Clerk metadata per request.

function sig(userId: string, endpointId: string): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY is required to sign endpoint cookies");
  return createHmac("sha256", secret).update(`${userId}|${endpointId}`).digest("base64url");
}

export function signEndpointCookie(userId: string, endpointId: string): string {
  return `${endpointId}.${sig(userId, endpointId)}`;
}

export function verifyEndpointCookie(userId: string, value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const endpointId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sig(userId, endpointId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return endpointId;
}
