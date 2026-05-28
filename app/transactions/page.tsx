"use client";
import { TransactionsPanel } from "@/components/transactions/TransactionsPanel";

export default function ActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Activity</h1>
      <TransactionsPanel />
    </div>
  );
}
