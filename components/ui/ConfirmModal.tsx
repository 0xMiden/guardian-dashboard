"use client";
import { Button } from "@/components/ui/Button";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmClass = "bg-state-frozen hover:brightness-110 text-white",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-xl bg-popover border p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h2 className="text-sm font-semibold mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <Button onClick={onCancel} size="lg">
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
