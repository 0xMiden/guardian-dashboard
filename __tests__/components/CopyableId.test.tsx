import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CopyableId } from "@/components/ui/CopyableId";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("CopyableId", () => {
  it("renders truncated id", () => {
    render(<CopyableId id="0x1234567890abcdef1234567890abcdef" prefixLen={10} suffixLen={6} />);
    expect(screen.getByText("0x12345678…abcdef")).toBeInTheDocument();
  });

  it("renders short id without truncation", () => {
    render(<CopyableId id="short" />);
    expect(screen.getByText("short")).toBeInTheDocument();
  });

  it("copies full id to clipboard on button click", async () => {
    const id = "0x1234567890abcdef1234567890abcdef";
    render(<CopyableId id={id} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(id);
    await waitFor(() => {
      expect(btn.querySelector(".text-state-active")).toBeInTheDocument();
    });
  });

  it("stops propagation on click", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyableId id="test-id" />
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("does not show copied state when clipboard write fails", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<CopyableId id="fail-id" />);
    const btn = screen.getByRole("button");
    expect(() => fireEvent.click(btn)).not.toThrow();
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fail-id");
    });
    expect(btn.querySelector(".text-state-active")).not.toBeInTheDocument();
  });

  // `navigator.clipboard` only exists in a secure context. Over plain http, which
  // is how a self-hosted dashboard or a phone pointed at the dev server reaches
  // this page, the whole object is undefined and reading `.writeText` off it
  // throws before the `.catch()` can see it. `GuardianStatusCard` has always
  // guarded this call; this one did not.
  it("does not throw when the page has no Clipboard API", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const onError = vi.fn();
    window.addEventListener("error", onError);
    render(<CopyableId id="no-clipboard" />);
    fireEvent.click(screen.getByRole("button"));
    // React reports an uncaught handler error asynchronously, so let it land.
    await act(async () => {});
    window.removeEventListener("error", onError);
    expect(onError).not.toHaveBeenCalled();
  });
});
