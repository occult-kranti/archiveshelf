import { useDeferredValue, useMemo, useState } from "react";
import { FileAudio, FileText, Plus, Search } from "lucide-react";
import { Link } from "react-router";
import AssetButton from "@/components/AssetButton";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, formatDuration } from "@/lib/format";
import { trpc } from "@/providers/trpc";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const videos = trpc.archive.list.useQuery(
    { search: deferredSearch },
    { refetchInterval: 10000 }
  );
  const channels = useMemo(
    () =>
      Array.from(
        new Set(
          (videos.data || []).map(video => video.channelName).filter(Boolean)
        )
      ).sort(),
    [videos.data]
  );
  const filtered = (videos.data || []).filter(
    video => channel === "all" || video.channelName === channel
  );
  const audioCount = (videos.data || []).filter(video => video.hasAudio).length;
  const transcriptCount = (videos.data || []).filter(
    video => video.hasTranscript
  ).length;

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Source archive
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Your library
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Search transcripts, inspect sources, and take only the audio and
            text with you.
          </p>
        </div>
        <Button asChild className="min-h-11 self-start sm:self-auto">
          <Link to="/import">
            <Plus className="mr-2 h-4 w-4" /> Import media
          </Link>
        </Button>
      </div>

      <dl className="mt-8 grid grid-cols-3 border-y">
        <div className="py-5 pr-3">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Sources
          </dt>
          <dd className="mt-1 text-2xl font-semibold">
            {videos.data?.length || 0}
          </dd>
        </div>
        <div className="border-l py-5 pl-4 sm:pl-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Transcripts
          </dt>
          <dd className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {transcriptCount}
          </dd>
        </div>
        <div className="border-l py-5 pl-4 sm:pl-6">
          <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Audio files
          </dt>
          <dd className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <FileAudio className="h-4 w-4 text-muted-foreground" />
            {audioCount}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search library and transcripts</span>
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search titles, channels, or transcript text…"
          />
        </label>
        <select
          className="h-11 min-h-11 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
          value={channel}
          onChange={event => setChannel(event.target.value)}
          aria-label="Filter by channel"
        >
          <option value="all">All channels</option>
          {channels.map(name => (
            <option key={name} value={name || ""}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {videos.isLoading ? (
        <div className="mt-8 space-y-3" aria-label="Loading library">
          {[1, 2, 3].map(item => (
            <div
              key={item}
              className="h-20 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      ) : videos.error ? (
        <div
          className="mt-8 rounded-lg border border-destructive/30 p-5 text-destructive"
          role="alert"
        >
          Could not load the library: {videos.error.message}
        </div>
      ) : filtered.length === 0 ? (
        <section className="mt-10 border-y py-14 text-center">
          <FolderSearchIcon />
          <h2 className="mt-4 text-xl font-semibold">
            {videos.data?.length
              ? "No matching sources"
              : "Start your research shelf"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            {videos.data?.length
              ? "Try a different search or channel filter."
              : "Import an authorized video, playlist, channel, or direct media URL. Your audio and transcript exports will appear here."}
          </p>
          {!videos.data?.length && (
            <Button asChild className="mt-6">
              <Link to="/import">Add your first source</Link>
            </Button>
          )}
        </section>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_110px_100px] gap-4 border-b bg-muted/55 px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:grid">
            <span>Source</span>
            <span>Status</span>
            <span>Length</span>
            <span>Size</span>
            <span className="text-right">Export</span>
          </div>
          <ul className="divide-y">
            {filtered.map(video => (
              <li
                key={video.id}
                className="grid gap-4 px-4 py-5 transition-colors hover:bg-muted/35 md:grid-cols-[minmax(0,1fr)_110px_90px_110px_100px] md:items-center md:px-5 md:py-4"
              >
                <div className="min-w-0">
                  <Link
                    to={`/videos/${video.id}`}
                    className="line-clamp-2 font-medium leading-6 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {video.title}
                  </Link>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {video.channelName || "Unknown channel"}
                  </p>
                  <div className="mt-3 flex items-center gap-4 font-mono text-xs text-muted-foreground md:hidden">
                    <span>{formatDuration(video.duration)}</span>
                    <span>{formatBytes(video.sizeBytes)}</span>
                  </div>
                </div>
                <div>
                  <StatusBadge status={video.status} />
                </div>
                <span className="hidden font-mono text-xs text-muted-foreground md:block">
                  {formatDuration(video.duration)}
                </span>
                <span className="hidden font-mono text-xs text-muted-foreground md:block">
                  {formatBytes(video.sizeBytes)}
                </span>
                <div className="md:text-right">
                  {video.hasBundle ? (
                    <AssetButton
                      videoId={video.id}
                      kind="bundle"
                      label="ZIP"
                      variant="outline"
                      size="sm"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No files
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FolderSearchIcon() {
  return (
    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
      <Search className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}
