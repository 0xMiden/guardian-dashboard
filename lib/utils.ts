import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * What a failing guardian-proxy route puts in its body. The fields past
 * `error` come from the Guardian's own error envelope (`meta`), forwarded by
 * `guardianRoute` so the UI can say which permission is missing or how long
 * the Guardian asked us to wait, rather than printing an HTTP status at someone.
 */
export type GuardianErrorBody = {
  error?: string;
  code?: string;
  missingPermissions?: string[];
  retryAfterSecs?: number;
};

export class FetchError extends Error {
  constructor(message: string, readonly status: number, readonly body?: GuardianErrorBody) {
    super(message);
  }
}

export const fetcher = async (url: string) => {
  const r = await fetch(url);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new FetchError(body?.error ?? `Request failed (${r.status})`, r.status, body ?? undefined);
  return body;
};
