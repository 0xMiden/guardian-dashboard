"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";

interface Props {
  accountId: string;
}

export function AccountTransactions({ accountId }: Props) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to account
      </button>

      <p className="text-xs text-muted-foreground font-mono truncate">{accountId}</p>

      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-20 text-center">
        <ArrowLeftRight className="h-8 w-8 text-zinc-600" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Transaction history not available</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Per-account transaction history requires Guardian to expose{" "}
            <code className="rounded bg-zinc-800 px-1">GET /accounts/:id/delta/since</code>.
            This will be connected once the Guardian API supports it.
          </p>
        </div>
      </div>
    </div>
  );
}
