import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { eq } from "drizzle-orm";
import { archiveJobs, videos } from "@db/schema";
import type { ArchiveOptions } from "@contracts/archive";
import { getDb } from "./queries/connection";
import { storage } from "./lib/storage";
import { env } from "./lib/env";
import { log } from "./lib/logger";

const active = new Map<number, ChildProcessWithoutNullStreams>();
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

type StartJob = {
  jobId: number;
  publicId: string;
  userId: number;
  urls: string[];
  options: ArchiveOptions;
};

type Manifest = {
  status: "complete" | "partial" | "failed";
  url: string;
  id?: string;
  title?: string;
  channel?: string;
  duration?: number;
  webpageUrl?: string;
  path?: string;
  relativePath?: string;
  artifacts?: Record<string, string>;
  transcriptText?: string;
  transcriptOrigin?: string;
  errors?: Array<{ stage: string; code: string; message: string }>;
};

function runtime() {
  const root = env.isProduction
    ? import.meta.dirname
    : path.resolve(import.meta.dirname, "..");
  return {
    worker: path.join(root, "worker", "archiveshelf.py"),
    python: path.join(root, env.isProduction ? "python" : ".python"),
  };
}

function pythonEnvironment() {
  return {
    ...process.env,
    PYTHONPATH: [runtime().python, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter),
    PYTHONUNBUFFERED: "1",
    WHISPER_DOWNLOAD_ROOT: process.env.WHISPER_DOWNLOAD_ROOT || path.join(os.tmpdir(), "archiveshelf-models"),
  };
}

async function updateJob(jobId: number, values: Record<string, unknown>) {
  await getDb()
    .update(archiveJobs)
    .set(values)
    .where(eq(archiveJobs.id, jobId));
}

function contentType(name: string) {
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function upload(
  userId: number,
  publicId: string,
  file: string,
  name: string
) {
  const details = await stat(file);
  if (details.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `${name} is ${Math.ceil(details.size / 1024 / 1024)} MB; the web export limit is 95 MB. Use the CLI for larger archives.`
    );
  }
  const fileContent = await readFile(file);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const saved = await storage.uploadFile({
        fileContent,
        fileName: `u/${userId}/${publicId}/${name}`,
        contentType: contentType(name),
      });
      return { key: saved.key, size: details.size };
    } catch (error) {
      lastError = error;
      const retryable =
        typeof error === "object" &&
        error !== null &&
        "retryable" in error &&
        error.retryable === true;
      if (!retryable || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function readManifest(entry: Manifest): Promise<Manifest> {
  if (!entry.path) return entry;
  try {
    const disk = JSON.parse(
      await readFile(path.join(entry.path, "manifest.json"), "utf8")
    ) as Manifest;
    return { ...disk, ...entry, transcriptText: disk.transcriptText ?? "" };
  } catch {
    return entry;
  }
}

async function ingestResults(job: StartJob, directory: string) {
  const exportDir = path.join(directory, "export");
  const indexPath = path.join(exportDir, "index.jsonl");
  let entries: Manifest[] = [];
  try {
    const raw = await readFile(indexPath, "utf8");
    entries = raw
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as Manifest);
  } catch {
    return { complete: 0, partial: 0, failed: 0, totalBytes: 0 };
  }

  let complete = 0;
  let partial = 0;
  let failed = 0;
  let totalBytes = 0;
  for (const rawEntry of entries) {
    const entry = await readManifest(rawEntry);
    const errors = entry.errors ?? [];
    const values: typeof videos.$inferInsert = {
      userId: job.userId,
      jobId: job.jobId,
      externalId: entry.id,
      url: entry.webpageUrl || entry.url,
      title: entry.title || entry.url,
      channelName: entry.channel,
      duration: entry.duration ? Math.round(entry.duration) : undefined,
      status: entry.status,
      error:
        errors
          .map(error => `${error.stage}/${error.code}: ${error.message}`)
          .join("\n") || undefined,
      transcriptText: entry.transcriptText || undefined,
      transcriptOrigin: entry.transcriptOrigin,
    };
    if (entry.status === "failed") failed += 1;
    if (entry.status === "partial") partial += 1;
    if (entry.status === "complete") complete += 1;

    if (entry.path && entry.relativePath && entry.artifacts) {
      try {
        const metadataPath = path.join(entry.path, "metadata.json");
        values.metadataJson = await readFile(metadataPath, "utf8").catch(
          () => undefined
        );
        if (entry.artifacts.transcriptJson) {
          values.transcriptData = await readFile(
            path.join(entry.path, entry.artifacts.transcriptJson),
            "utf8"
          ).catch(() => undefined);
        }
        if (entry.artifacts.audio) {
          const audioName = entry.artifacts.audio;
          const uploaded = await upload(
            job.userId,
            job.publicId,
            path.join(entry.path, audioName),
            `${entry.relativePath}/${audioName}`
          );
          values.audioKey = uploaded.key;
          values.audioFormat = path.extname(audioName).slice(1);
          values.sizeBytes = uploaded.size;
          totalBytes += uploaded.size;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        values.error = [values.error, message].filter(Boolean).join("\n");
        values.status =
          values.audioKey || values.transcriptKey ? "partial" : "failed";
        log.error("export ingestion failed", {
          jobId: job.jobId,
          error: message,
        });
      }
    }
    await getDb().insert(videos).values(values);
  }
  return { complete, partial, failed, totalBytes };
}

export async function startArchiveJob(job: StartJob) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "archiveshelf-"));
  const output = path.join(directory, "export");
  const args = [
    runtime().worker,
    "archive",
    "--output",
    output,
    "--audio-format",
    job.options.audioFormat,
    "--languages",
    job.options.languages,
    "--concurrency",
    String(job.options.concurrency),
    "--max-items",
    String(job.options.maxItems),
    "--rights-confirmed",
  ];
  for (const url of job.urls) args.push("--url", url);
  if (job.options.transcribeMissing) args.push("--transcribe-missing", "--whisper-backend", job.options.whisperBackend);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn("python3", args, {
      cwd: path.dirname(runtime().worker),
      env: pythonEnvironment(),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    await updateJob(job.jobId, { status: "failed", message: String(error) });
    await rm(directory, { recursive: true, force: true });
    return;
  }
  active.set(job.jobId, child);
  await updateJob(job.jobId, { status: "running", message: undefined });
  let stderr = "";
  let processed = 0;
  let failed = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      const message = JSON.parse(line);
      if (message.type === "batch_started") {
        void updateJob(job.jobId, { total: message.total });
      }
      if (message.type === "batch_progress") {
        processed = message.completed;
        if (message.status === "failed") failed += 1;
        void updateJob(job.jobId, { completed: processed, failed });
      }
    } catch {
      log.warn("non-JSON worker output", {
        jobId: job.jobId,
        line: line.slice(0, 300),
      });
    }
  });
  child.stderr.on("data", chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-12000);
  });

  await new Promise<void>(resolve => {
    child.on("error", error => {
      stderr += error.message;
      resolve();
    });
    child.on("close", () => resolve());
  });
  active.delete(job.jobId);
  lines.close();

  try {
    const current = await getDb()
      .select()
      .from(archiveJobs)
      .where(eq(archiveJobs.id, job.jobId))
      .limit(1);
    if (current[0]?.status === "cancelling") {
      await updateJob(job.jobId, {
        status: "cancelled",
        message: "Cancelled by user",
      });
      return;
    }
    const result = await ingestResults(job, directory);
    const message = stderr.trim() || undefined;
    const succeeded = result.complete + result.partial;
    const status =
      succeeded === 0
        ? "failed"
        : result.failed > 0 || result.partial > 0 || message
          ? "partial"
          : "complete";
    await updateJob(job.jobId, {
      status,
      message,
      completed: result.complete + result.partial + result.failed,
      failed: result.failed,
      total: result.complete + result.partial + result.failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("archive job failed", { jobId: job.jobId, error: message });
    await updateJob(job.jobId, { status: "failed", message });
  } finally {
    active.delete(job.jobId);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function cancelArchiveJob(jobId: number) {
  await updateJob(jobId, { status: "cancelling" });
  const child = active.get(jobId);
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    await updateJob(jobId, { status: "cancelled" });
  }
}
