import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("copies full id to clipboard on button click", () => {
    const id = "0x1234567890abcdef1234567890abcdef";
    render(<CopyableId id={id} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(id);
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

  it("handles clipboard failure gracefully", () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<CopyableId id="fail-id" />);
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
  });
});
