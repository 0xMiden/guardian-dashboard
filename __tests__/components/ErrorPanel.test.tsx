import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { FetchError } from "@/lib/utils";

const err = (status: number, body?: Record<string, unknown>) =>
  new FetchError(body?.error as string ?? "boom", status, body);

describe("ErrorPanel", () => {
  // The case that sent us to KODA: the panel used to print
  // "Guardian operator HTTP error 403: Forbidden - You don't have permission
  // to do that", which names neither the permission nor who can grant it.
  it("names the permission the node is withholding", () => {
    render(<ErrorPanel error={err(403, {
      code: "insufficient_operator_permission",
      missingPermissions: ["accounts:pause"],
    })} />);
    expect(screen.getByText(/accounts:pause/)).toBeInTheDocument();
  });

  it("still explains a 403 that arrives without the permission list", () => {
    render(<ErrorPanel error={err(403)} />);
    expect(screen.getByText("Permission needed")).toBeInTheDocument();
  });

  it("reads a 401 as an unrecognised key, since the proxy already retried auth", () => {
    render(<ErrorPanel error={err(401, { code: "authentication_failed" })} />);
    expect(screen.getByText(/does not recognise this operator key/i)).toBeInTheDocument();
  });

  it("passes on the node's own retry-after rather than inventing a wait", () => {
    render(<ErrorPanel error={err(429, { retryAfterSecs: 12 })} />);
    expect(screen.getByText(/12s/)).toBeInTheDocument();
  });

  it("separates a missing record from a broken node", () => {
    render(<ErrorPanel error={err(404, { code: "account_not_found" })} />);
    expect(screen.getByText("Not found on this node")).toBeInTheDocument();
  });

  it("treats anything the node never answered as unavailable", () => {
    render(<ErrorPanel error={err(503, { error: "fetch failed" })} />);
    expect(screen.getByText("Guardian node unavailable")).toBeInTheDocument();
  });

  // Retrying a permission denial or a missing account cannot succeed, so the
  // button would be an invitation to a second identical failure.
  it("offers a retry only where retrying could work", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorPanel error={err(503)} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();

    rerender(<ErrorPanel error={err(403)} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("falls back for an error that never came from a fetch", () => {
    render(<ErrorPanel error={new Error("something odd")} />);
    expect(screen.getByText("something odd")).toBeInTheDocument();
  });
});
