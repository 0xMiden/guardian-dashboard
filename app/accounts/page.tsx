import { AccountsPanel } from "@/components/accounts/AccountsPanel";

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Accounts</h1>
      <AccountsPanel />
    </div>
  );
}
