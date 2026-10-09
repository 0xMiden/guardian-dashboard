/** A label and its value on a detail page: label left and muted, value right. */
export function DetailRow({ label, value, title }: { label: React.ReactNode; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground shrink-0" title={title}>{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
