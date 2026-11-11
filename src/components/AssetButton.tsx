import { useState, type ComponentProps } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "./ui/button";

type Props = ComponentProps<typeof Button> & {
  videoId: number;
  kind: "audio" | "bundle" | "transcript";
  label: string;
};

export default function AssetButton({ videoId, kind, label, ...props }: Props) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        {...props}
        disabled={pending || props.disabled}
        onClick={async event => {
          event.preventDefault();
          event.stopPropagation();
          setPending(true);
          setError("");
          try {
            const { url } = await utils.archive.asset.fetch({
              id: videoId,
              kind,
            });
            window.open(url, "_blank", "noopener,noreferrer");
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : "Download failed"
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? (
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {label}
      </Button>
      {error && (
        <span className="max-w-64 text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
