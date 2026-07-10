import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export class FetchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const fetcher = async (url: string) => {
  const r = await fetch(url);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new FetchError(body?.error ?? `Request failed (${r.status})`, r.status);
  return body;
};
