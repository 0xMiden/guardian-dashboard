import { AccountDetail } from "@/components/accounts/AccountDetail";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">Account Detail</h1>
      <AccountDetail accountId={decodeURIComponent(accountId)} />
    </div>
  );
}
