import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
} from "lucide-react";
import { Link, useParams } from "react-router";
import AssetButton from "@/components/AssetButton";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration, saveText } from "@/lib/format";
import { trpc } from "@/providers/trpc";

const tabs = ["Transcript", "Details", "Exports"] as const;
type Tab = (typeof tabs)[number];

export default function VideoPage() {
  const params = useParams();
  const id = Number(params.id);
  const video = trpc.archive.byId.useQuery(
    { id },
    { enabled: Number.isInteger(id) && id > 0 }
  );
  const [tab, setTab] = useState<Tab>("Transcript");
  const [copied, setCopied] = useState(false);
  if (video.isLoading)
    return <div className="h-96 animate-pulse rounded-xl bg-muted" />;
  if (video.error || !video.data)
    return (
      <div className="rounded-lg border border-destructive/30 p-5 text-destructive">
        {video.error?.message || "Source not found"}
      </div>
    );
  const data = video.data;

  async function copyTranscript() {
    await navigator.clipboard.writeText(data.transcriptText || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="max-w-6xl">
      <Button asChild variant="ghost" className="-ml-3">
        <Link to="/">
          <ArrowLeft className="mr-2 h-4 w-4" /> Library
        </Link>
      </Button>
      <div className="mt-4 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {data.channelName || "Unknown channel"}
            </p>
            <StatusBadge status={data.status} />
          </div>
          <h1 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {data.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>{formatDuration(data.duration)}</span>
            <span>{formatBytes(data.sizeBytes)}</span>
            <span>
              Imported {new Date(data.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <Button asChild variant="outline" className="self-start">
          <a href={data.url} target="_blank" rel="noreferrer">
            Open source <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>

      {data.hasAudio && <AudioPlayer videoId={data.id} title={data.title} />}

      <div
        className="mt-7 flex gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label="Source details"
      >
        {tabs.map(name => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === name ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Transcript" && (
        <section className="py-7" role="tabpanel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {data.transcriptOrigin || "No transcript available"}
            </p>
            {data.transcriptText && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={copyTranscript}>
                  {copied ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    saveText(`${data.title}.txt`, data.transcriptText || "")
                  }
                >
                  <Download className="mr-2 h-4 w-4" /> TXT
                </Button>
              </div>
            )}
          </div>
          {data.transcriptText ? (
            <article className="mt-6 max-w-[70ch] whitespace-pre-wrap text-base leading-8">
              {data.transcriptText}
            </article>
          ) : (
            <div className="mt-8 border-y py-10">
              <p className="text-lg font-medium">No transcript was exported.</p>
              <p className="mt-2 max-w-xl leading-7 text-muted-foreground">
                This source may not have captions, or local transcription was
                not enabled. The audio export and error details remain available
                where processing succeeded.
              </p>
            </div>
          )}
        </section>
      )}

      {tab === "Details" && (
        <section className="max-w-3xl py-7" role="tabpanel">
          <dl className="grid gap-0 border-t text-sm sm:grid-cols-[180px_1fr]">
            {[
              ["Channel", data.channelName || "Unknown"],
              ["Processing status", data.status],
              ["Duration", formatDuration(data.duration)],
              ["Audio format", data.audioFormat || "None"],
              ["Transcript origin", data.transcriptOrigin || "None"],
              ["Source URL", data.url],
            ].map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="border-b py-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {label}
                </dt>
                <dd className="break-words border-b py-4">{value}</dd>
              </div>
            ))}
          </dl>
          {data.error && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <h2 className="font-medium">Processing notes</h2>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6">
                {data.error}
              </pre>
            </div>
          )}
        </section>
      )}

      {tab === "Exports" && (
        <section className="max-w-3xl py-7" role="tabpanel">
          <h2 className="text-lg font-semibold">Download this source</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            The ZIP contains every available transcript format, metadata, the
            manifest, and audio when requested.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {data.hasBundle && (
              <AssetButton
                videoId={data.id}
                kind="bundle"
                label="All files · ZIP"
              />
            )}
            {data.hasAudio && (
              <AssetButton
                videoId={data.id}
                kind="audio"
                label={`Audio · ${(data.audioFormat || "audio").toUpperCase()}`}
                variant="outline"
              />
            )}
            {data.hasTranscript && (
              <AssetButton
                videoId={data.id}
                kind="transcript"
                label="Transcript · Markdown"
                variant="outline"
              />
            )}
          </div>
          {!data.hasBundle && !data.hasAudio && !data.hasTranscript && (
            <p className="mt-6 text-muted-foreground">
              No downloadable files were produced for this source.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function AudioPlayer({ videoId, title }: { videoId: number; title: string }) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    utils.archive.asset
      .fetch({ id: videoId, kind: "audio" })
      .then(result => {
        if (current) setUrl(result.url);
      })
      .catch(cause => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Audio could not be loaded"
          );
      });
    return () => {
      current = false;
    };
  }, [utils, videoId]);
  return (
    <section className="mt-7 rounded-xl border bg-muted/35 p-5">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <FileAudio className="h-4 w-4" /> Audio preview
      </div>
      {url ? (
        <audio
          className="mt-4 w-full"
          controls
          preload="none"
          src={url}
          aria-label={`Audio for ${title}`}
        />
      ) : (
        <div
          className="mt-4 h-9 animate-pulse rounded bg-muted"
          aria-label="Loading audio"
        />
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
