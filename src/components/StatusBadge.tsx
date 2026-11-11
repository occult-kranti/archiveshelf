import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  complete: "bg-green-50 text-green-800 border-green-200",
  partial: "bg-amber-50 text-amber-900 border-amber-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  queued: "bg-muted text-muted-foreground border-border",
  cancelling: "bg-amber-50 text-amber-900 border-amber-200",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px] capitalize",
        styles[status] || styles.queued
      )}
    >
      {status}
    </span>
  );
}
