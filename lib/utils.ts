import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The type scale in globals.css (text-label, text-data, ...) is unknown to
// tailwind-merge, which filed those classes under text colour and dropped
// `text-label` whenever a colour class came after it: a coloured button then
// fell back to the browser's font size.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["data", "figure", "label", "section", "stat", "subtitle", "title"] }] } },
});

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

/**
 * Offer a CSV to the browser as a download. In the document and revoked on
 * the next tick: Safari ignores a click on a detached anchor, and revoking in
 * the same tick can cancel the download before the browser has read the blob.
 */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
