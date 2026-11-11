import { ListChecks, Plus } from "lucide-react";
import { Link } from "react-router";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";

export default function JobsPage() {
  const jobs = trpc.archive.jobs.useQuery(undefined, { refetchInterval: 4000 });
  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Processing history
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Archive jobs
          </h1>
          <p className="mt-2 text-muted-foreground">
            Monitor progress, review partial failures, and download completed
            batches.
          </p>
        </div>
        <Button asChild className="self-start">
          <Link to="/import">
            <Plus className="mr-2 h-4 w-4" /> New job
          </Link>
        </Button>
      </div>

      {jobs.isLoading ? (
        <div className="mt-8 space-y-3">
          {[1, 2, 3].map(item => (
            <div
              className="h-24 animate-pulse rounded-lg bg-muted"
              key={item}
            />
          ))}
        </div>
      ) : jobs.error ? (
        <div className="mt-8 text-destructive" role="alert">
          {jobs.error.message}
        </div>
      ) : !jobs.data?.length ? (
        <section className="mt-10 border-y py-14 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">No archive jobs yet</h2>
          <p className="mt-2 text-muted-foreground">
            Start with one URL or the built-in CC0 test source.
          </p>
          <Button asChild className="mt-6">
            <Link to="/import">Create an import</Link>
          </Button>
        </section>
      ) : (
        <div className="mt-8 overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[minmax(0,1fr)_120px_130px_180px] gap-4 border-b bg-muted/55 px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Job</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Started</span>
          </div>
          <ul className="divide-y">
            {jobs.data.map(job => (
              <li key={job.publicId}>
                <Link
                  to={`/jobs/${job.publicId}`}
                  className="grid gap-3 px-4 py-5 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_120px_130px_180px] sm:items-center sm:px-5 sm:py-4"
                >
                  <div>
                    <span className="font-mono text-sm">
                      {job.publicId.slice(0, 8)}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {job.hasDownload
                        ? "Batch ZIP available"
                        : "Per-video exports"}
                    </p>
                  </div>
                  <div>
                    <StatusBadge status={job.status} />
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {job.completed} / {job.total || "…"} processed
                    {job.failed ? ` · ${job.failed} failed` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
