"use client";
import { AlertTriangle, Lock, Clock, SearchX, PlugZap } from "lucide-react";
import { FetchError } from "@/lib/utils";

export type ErrorShape = {
  icon: React.ReactNode;
  title: string;
  detail: string;
  /** False where retrying cannot help, so we do not invite a pointless click. */
  retryable: boolean;
};

/**
 * Turns a failed guardian-proxy request into something an operator can act on.
 *
 * The branch is on the node's `code` first and the HTTP status second, which is
 * the order the client's own docs recommend (FR-028): the status alone cannot
 * tell a permission denial from an expired session, and both arrive as 403/401.
 *
 * Exported because the freeze/unfreeze modal needs the same wording in a space
 * far too small for the panel below.
 */
export function describeError(error: unknown): ErrorShape {
  // Anything not raised by `fetcher` has no status to reason about, so it lands
  // on the generic branch rather than being guessed at.
  return describe(
    error instanceof FetchError
      ? error
      : new FetchError(error instanceof Error ? error.message : "The request failed.", 0),
  );
}

function describe(error: FetchError): ErrorShape {
  const { code, missingPermissions, retryAfterSecs } = error.body ?? {};

  if (code === "insufficient_operator_permission" || error.status === 403) {
    const missing = missingPermissions?.length ? missingPermissions.join(", ") : null;
    return {
      icon: <Lock className="h-4 w-4" />,
      title: "Permission needed",
      detail: missing
        ? `This node has not granted the dashboard's operator key ${missing}. Ask whoever runs it to add the permission to their allowlist entry.`
        : "This node has not granted the dashboard's operator key permission for this action.",
      retryable: false,
    };
  }

  // The proxy re-authenticates once before giving up, so a 401 reaching here
  // means the node does not accept our key at all rather than that a session
  // aged out. That is the state a newly-added node sits in until it allowlists
  // the key, and it is not something the reader can fix by signing in again.
  if (code === "authentication_failed" || error.status === 401) {
    return {
      icon: <Lock className="h-4 w-4" />,
      title: "Node does not recognise this operator key",
      detail: "Authentication was rejected. The endpoint needs the dashboard's public key in its operator allowlist.",
      retryable: false,
    };
  }

  if (error.status === 429) {
    return {
      icon: <Clock className="h-4 w-4" />,
      title: "Too many requests",
      detail: retryAfterSecs
        ? `The node asked us to wait ${retryAfterSecs}s before trying again.`
        : "The node is rate-limiting this operator. Wait a moment before trying again.",
      retryable: true,
    };
  }

  if (code === "account_not_found" || error.status === 404) {
    return {
      icon: <SearchX className="h-4 w-4" />,
      title: "Not found on this node",
      detail: "This guardian does not hold the record you asked for. It may belong to a different endpoint.",
      retryable: false,
    };
  }

  if (error.status >= 500) {
    return {
      icon: <PlugZap className="h-4 w-4" />,
      title: "Guardian node unavailable",
      detail: error.message || "The node did not answer.",
      retryable: true,
    };
  }

  return {
    icon: <AlertTriangle className="h-4 w-4" />,
    title: "Something went wrong",
    detail: error.message || "The request failed.",
    retryable: true,
  };
}

export function ErrorPanel({
  error,
  onRetry,
  className = "",
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const shape = describeError(error);

  return (
    <div role="alert" className={`flex flex-col items-center gap-2 px-4 py-8 text-center ${className}`}>
      <span className="text-muted-foreground">{shape.icon}</span>
      <p className="text-sm font-medium">{shape.title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{shape.detail}</p>
      {shape.retryable && onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try again
        </button>
      )}
    </div>
  );
}
