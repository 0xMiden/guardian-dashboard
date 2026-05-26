import { AccountDeltaDetail } from "@/components/accounts/AccountDeltaDetail";

export default async function DeltaDetailPage({
  params,
}: {
  params: Promise<{ accountId: string; nonce: string }>;
}) {
  const { accountId, nonce } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Transaction Details</h1>
      <AccountDeltaDetail
        accountId={decodeURIComponent(accountId)}
        nonce={parseInt(nonce, 10)}
      />
    </div>
  );
}
