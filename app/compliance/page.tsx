import { CompliancePanel } from "@/components/compliance/CompliancePanel";

export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Compliance</h1>
      <CompliancePanel />
    </div>
  );
}
