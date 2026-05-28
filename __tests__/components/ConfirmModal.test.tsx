import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

describe("ConfirmModal", () => {
  const baseProps = {
    title: "Are you sure?",
    message: "This action cannot be undone.",
    confirmLabel: "Confirm",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders title, message, and buttons", () => {
    render(<ConfirmModal {...baseProps} />);
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmModal {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("applies custom confirmClass", () => {
    render(<ConfirmModal {...baseProps} confirmLabel="Delete" confirmClass="bg-red-500 text-white" />);
    const btn = screen.getByText("Delete");
    expect(btn.className).toContain("bg-red-500");
  });
});
