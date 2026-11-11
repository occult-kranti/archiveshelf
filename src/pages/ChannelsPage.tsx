import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Download, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/StatusBadge";
import { formatDuration } from "@/lib/format";

type Summary = {
  channel: string;
  url: string | null;
  identityStatus: string;
  verification: string;
  scopes: string[];
  expectedCount: number | null;
  indexEntries: number;
  sourceItems: number;
  totalVideos: number;
  earliestVideo: string | null;
  latestVideo: string | null;
  metadataComplete: number;
  transcripts: number;
  totalDurationSeconds: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  withCaptions: number;
  duplicatesRemoved: number;
  errors: string[];
  channelWideVerified: boolean;
  coverageNote: string;
};

type Video = {
  channel: string;
  scope: string;
  external_id: string;
  source_item_number: string | null;
  title: string;
  webpage_url: string;
  source_url: string;
  upload_date: string | null;
  location: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  description: string | null;
  language: string | null;
  categories: string | null;
  tags: string | null;
  availability: string | null;
  live_status: string | null;
  subtitle_languages: string | null;
  automatic_caption_languages: string | null;
  transcript_path: string | null;
  metadata_status: string;
  error: string | null;
};

export default function ChannelsPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState("Kryon Lee Carroll");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/inventory/channel-summary.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Channel summary not found"))),
      fetch("/inventory/videos.json").then((response) => response.ok ? response.json() : Promise.reject(new Error("Video inventory not found"))),
    ]).then(([summaryData, videoData]) => {
      setSummaries(summaryData);
      setVideos(videoData);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Inventory could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const current = summaries.find((summary) => summary.channel === selected);
  const currentVideos = useMemo(() => videos.filter((video) => {
    if (video.channel !== selected) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [video.title, video.external_id, video.source_item_number, video.description]
      .some((value) => value?.toLowerCase().includes(needle));
  }), [videos, selected, query]);
  const totals = summaries.reduce((sum, summary) => sum + summary.totalVideos, 0);

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scoped source intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Channel inventory</h1>
          <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">Every requested channel remains visible, including unresolved identities and blocked sources. Creator-index coverage is never presented as channel-wide completeness.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href="/inventory/channels.csv" download><Download className="mr-2 h-4 w-4" /> Channels CSV</a></Button>
          <Button asChild variant="outline"><a href="/inventory/videos.csv" download><Download className="mr-2 h-4 w-4" /> Videos CSV</a></Button>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 border-y sm:grid-cols-4">
        {[
          ["Requested channels", summaries.length],
          ["Verified identities", summaries.filter((summary) => summary.identityStatus === "verified").length],
          ["Unique indexed videos", totals],
          ["Channel-wide verified", summaries.filter((summary) => summary.channelWideVerified).length],
        ].map(([label, value]) => <div className="border-l py-5 pl-4 first:border-l-0 first:pl-0 sm:pl-6" key={label}><dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}
      </dl>

      {loading ? <div className="mt-8 h-64 animate-pulse rounded-xl bg-muted" /> : error ? <div className="mt-8 rounded-lg border border-destructive/30 p-5 text-destructive" role="alert">{error}</div> : (
        <>
          <div className="mt-7 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/55 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-normal">Channel</th><th className="px-4 py-3 font-normal">Scope</th><th className="px-4 py-3 font-normal">Earliest</th><th className="px-4 py-3 font-normal">Latest</th><th className="px-4 py-3 font-normal">Raw rows</th><th className="px-4 py-3 font-normal">Items</th><th className="px-4 py-3 font-normal">Unique</th><th className="px-4 py-3 font-normal">Transcripts</th><th className="px-4 py-3 font-normal">Action</th></tr></thead>
              <tbody className="divide-y">
                {summaries.map((summary) => <tr key={summary.channel} className={selected === summary.channel ? "bg-accent/45" : "hover:bg-muted/35"}>
                  <td className="max-w-56 px-4 py-4"><div className="font-medium">{summary.channel}</div><div className="mt-1 text-xs capitalize text-muted-foreground">{summary.identityStatus}</div></td>
                  <td className="max-w-48 px-4 py-4 text-xs text-muted-foreground">{summary.scopes.join(" / ")}</td>
                  <td className="px-4 py-4 font-mono text-xs">{summary.earliestVideo || "—"}</td>
                  <td className="px-4 py-4 font-mono text-xs">{summary.latestVideo || "—"}</td>
                  <td className="px-4 py-4 font-mono text-xs">{summary.indexEntries}</td>
                  <td className="px-4 py-4 font-mono text-xs">{summary.sourceItems}</td>
                  <td className="px-4 py-4 font-mono text-xs font-semibold">{summary.totalVideos}</td>
                  <td className="px-4 py-4 font-mono text-xs">{summary.transcripts}</td>
                  <td className="px-4 py-4"><Button size="sm" variant={selected === summary.channel ? "default" : "outline"} onClick={() => { setSelected(summary.channel); setExpanded(null); document.getElementById("channel-videos")?.scrollIntoView({ block: "start" }); }}>Inspect</Button></td>
                </tr>)}
              </tbody>
            </table>
          </div>

          {current && <section id="channel-videos" className="mt-10 scroll-mt-6">
            <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-semibold tracking-tight">{current.channel}</h2><StatusBadge status={current.identityStatus === "verified" ? "complete" : "queued"} /></div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{current.verification}</p>
                <p className="mt-2 max-w-3xl text-sm leading-6">{current.coverageNote}</p>
                {current.url && <a className="mt-3 inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline" href={current.url} target="_blank" rel="noreferrer">Open verified channel <ExternalLink className="ml-1 h-3.5 w-3.5" /></a>}
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Raw / items / unique</dt><dd className="mt-1 font-mono font-semibold">{current.indexEntries} / {current.sourceItems} / {current.totalVideos}</dd></div>
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Duplicates removed</dt><dd className="mt-1 font-mono">{current.duplicatesRemoved}</dd></div>
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Views / likes / comments</dt><dd className="mt-1 font-mono">{current.totalViews} / {current.totalLikes} / {current.totalComments}</dd></div>
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Duration</dt><dd className="mt-1 font-mono">{formatDuration(current.totalDurationSeconds)}</dd></div>
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Captioned</dt><dd className="mt-1 font-mono">{current.withCaptions}</dd></div>
                <div><dt className="font-mono text-[11px] uppercase text-muted-foreground">Transcripts</dt><dd className="mt-1 font-mono">{current.transcripts}</dd></div>
              </dl>
            </div>

            {current.errors.length > 0 && <div className="mt-5 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div>{current.errors.map((message) => <p key={message}>{message}</p>)}</div></div>}

            <label className="relative mt-6 block max-w-xl"><span className="sr-only">Search videos in this channel</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input className="h-11 pl-9" placeholder="Search titles, IDs, descriptions…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>

            {currentVideos.length ? <div className="mt-5 overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-muted/55 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-normal">Date</th><th className="px-4 py-3 font-normal">Video</th><th className="px-4 py-3 font-normal">Source item</th><th className="px-4 py-3 font-normal">Views</th><th className="px-4 py-3 font-normal">Duration</th><th className="px-4 py-3 font-normal">Metadata</th><th className="px-4 py-3 font-normal">Details</th></tr></thead>
                <tbody className="divide-y">
                  {currentVideos.map((video) => <VideoRows key={`${video.scope}-${video.external_id}`} video={video} expanded={expanded === video.external_id} onToggle={() => setExpanded(expanded === video.external_id ? null : video.external_id)} />)}
                </tbody>
              </table>
            </div> : <div className="mt-6 border-y py-10 text-muted-foreground">No video records are available for this channel in the current verified scope.</div>}
          </section>}
        </>
      )}
    </div>
  );
}

function VideoRows({ video, expanded, onToggle }: { video: Video; expanded: boolean; onToggle: () => void }) {
  const metrics: Array<[string, string | number | null]> = [
    ["Location", video.location], ["Description", video.description], ["Language", video.language],
    ["Categories", video.categories], ["Tags", video.tags], ["Availability", video.availability],
    ["Live status", video.live_status], ["Subtitle languages", video.subtitle_languages],
    ["Automatic captions", video.automatic_caption_languages], ["Transcript", video.transcript_path],
    ["Source index", video.source_url], ["Error", video.error],
  ];
  return (
    <>
      <tr className="align-top hover:bg-muted/35">
        <td className="whitespace-nowrap px-4 py-4 font-mono text-xs">{video.upload_date || "—"}</td>
        <td className="max-w-md px-4 py-4"><a className="font-medium underline-offset-4 hover:underline" href={video.webpage_url} target="_blank" rel="noreferrer">{video.title}</a><div className="mt-1 font-mono text-xs text-muted-foreground">{video.external_id}</div></td>
        <td className="px-4 py-4 font-mono text-xs">{video.source_item_number || "—"}</td>
        <td className="px-4 py-4 font-mono text-xs">{video.view_count ?? "—"}</td>
        <td className="px-4 py-4 font-mono text-xs">{formatDuration(video.duration_seconds)}</td>
        <td className="px-4 py-4 text-xs capitalize">{video.metadata_status.replaceAll("_", " ")}</td>
        <td className="px-4 py-4"><Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>{expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />} Details</Button></td>
      </tr>
      {expanded && <tr className="bg-muted/30"><td colSpan={7} className="px-5 py-5"><dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{metrics.map(([label, value]) => <div key={label}><dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{value || "—"}</dd></div>)}</dl></td></tr>}
    </>
  );
}
