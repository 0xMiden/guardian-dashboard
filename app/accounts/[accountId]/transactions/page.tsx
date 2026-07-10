import { AccountTransactions } from "@/components/accounts/AccountTransactions";

export default async function AccountTransactionsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Activity</h1>
      {/* key resets pagination state when navigating between accounts */}
      <AccountTransactions key={accountId} accountId={decodeURIComponent(accountId)} />
    </div>
  );
}
