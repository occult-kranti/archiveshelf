import { useState } from "react";
import { ArrowLeft, Ban, Download, LoaderCircle } from "lucide-react";
import { Link, useParams } from "react-router";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/providers/trpc";

const activeStatuses = ["queued", "running", "cancelling"];

export default function JobDetailPage() {
  const { publicId = "" } = useParams();
  const utils = trpc.useUtils();
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState("");
  const job = trpc.archive.job.useQuery(
    { publicId },
    {
      refetchInterval: query =>
        query.state.data && activeStatuses.includes(query.state.data.status)
          ? 1500
          : false,
    }
  );
  const videos = trpc.archive.list.useQuery(
    {},
    {
      refetchInterval:
        job.data && activeStatuses.includes(job.data.status) ? 2500 : false,
    }
  );
  const cancel = trpc.archive.cancel.useMutation({
    onSuccess: () => utils.archive.job.invalidate({ publicId }),
  });
  if (job.isLoading)
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  if (job.error || !job.data)
    return (
      <div className="rounded-lg border border-destructive/30 p-5 text-destructive">
        {job.error?.message || "Job not found"}
      </div>
    );
  const data = job.data;
  const percentage = data.total
    ? Math.min(100, Math.round((data.completed / data.total) * 100))
    : 0;
  const items = (videos.data || []).filter(video => video.jobId === data.id);

  async function download() {
    setDownloading(true);
    setActionError("");
    try {
      const { url } = await utils.archive.jobDownload.fetch({ publicId });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Download failed"
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <Button asChild variant="ghost" className="-ml-3">
        <Link to="/jobs">
          <ArrowLeft className="mr-2 h-4 w-4" /> All jobs
        </Link>
      </Button>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">
              {data.publicId.slice(0, 8)}
            </h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Started {new Date(data.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.hasDownload && (
            <Button onClick={download} disabled={downloading}>
              {downloading ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}{" "}
              Download batch ZIP
            </Button>
          )}
          {["queued", "running"].includes(data.status) && (
            <Button
              variant="outline"
              onClick={() => cancel.mutate({ publicId })}
              disabled={cancel.isPending}
            >
              <Ban className="mr-2 h-4 w-4" /> Cancel job
            </Button>
          )}
        </div>
      </div>

      <section className="mt-8 border-y py-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Overall progress
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {data.completed}{" "}
              <span className="text-base font-normal text-muted-foreground">
                of {data.total || "…"} items
              </span>
            </p>
          </div>
          <span className="font-mono text-sm">{percentage}%</span>
        </div>
        <Progress value={percentage} className="mt-5 h-2" />
        <div className="mt-4 flex gap-6 text-sm text-muted-foreground">
          <span>{data.failed} failed</span>
          <span>{Math.max(0, data.completed - data.failed)} with exports</span>
        </div>
      </section>

      {(data.message || actionError) && (
        <div
          className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
          role="status"
        >
          <p className="font-medium">Job notes</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans">
            {actionError || data.message}
          </pre>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Items from this run</h2>
        {items.length ? (
          <ul className="mt-4 divide-y rounded-xl border">
            {items.map(video => (
              <li
                key={video.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    to={`/videos/${video.id}`}
                  >
                    {video.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {video.channelName || "Unknown channel"}
                  </p>
                </div>
                <StatusBadge status={video.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {activeStatuses.includes(data.status)
              ? "Items will appear as the worker finishes them."
              : "No library items were recorded for this job."}
          </p>
        )}
      </section>
    </div>
  );
}
