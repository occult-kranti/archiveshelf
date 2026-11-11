import { strToU8, zipSync } from "fflate/browser";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { archiveJobs, videos } from "@db/schema";
import { authenticateRequest } from "../kimi/auth";
import { getDb } from "../queries/connection";
import { storage } from "../lib/storage";

const downloads = new Hono();
const MAX_WEB_BUNDLE_BYTES = 95 * 1024 * 1024;

type VideoRow = typeof videos.$inferSelect;
type Segment = { start: number; end: number; text: string };
type ZipFiles = Record<string, Uint8Array>;

function safeName(value: string) {
  const visible = Array.from(value.normalize("NFKC"))
    .filter(character => {
      const code = character.codePointAt(0) || 0;
      return code >= 32 && code !== 127 && !'<>:"/\\|?*'.includes(character);
    })
    .join(" ");
  return visible.replace(/\s+/g, " ").trim().slice(0, 90) || "source";
}

function timestamp(value: number, srt = false) {
  let millis = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(millis / 3600000);
  millis %= 3600000;
  const minutes = Math.floor(millis / 60000);
  millis %= 60000;
  const seconds = Math.floor(millis / 1000);
  millis %= 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${srt ? "," : "."}${String(millis).padStart(3, "0")}`;
}

function segments(video: VideoRow): Segment[] {
  if (!video.transcriptData) return [];
  try {
    const parsed = JSON.parse(video.transcriptData);
    return Array.isArray(parsed.segments)
      ? parsed.segments.filter(
          (segment: Segment) =>
            Number.isFinite(segment.start) &&
            Number.isFinite(segment.end) &&
            typeof segment.text === "string"
        )
      : [];
  } catch {
    return [];
  }
}

function markdown(video: VideoRow) {
  return `# ${video.title}\n\n- Source: ${video.url}\n- Channel: ${video.channelName || "Unknown"}\n- Transcript origin: ${video.transcriptOrigin || "unknown"}\n\n${video.transcriptText || ""}\n`;
}

function attachment(name: string) {
  const ascii = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function text(files: ZipFiles, name: string, content: string) {
  files[name] = strToU8(content);
}

async function appendVideo(
  files: ZipFiles,
  video: VideoRow,
  parent = "ArchiveShelf"
) {
  const base = `${parent}/${safeName(video.title)} [${video.id}]`;
  if (video.transcriptText) {
    text(files, `${base}/transcript.txt`, video.transcriptText);
    text(files, `${base}/transcript.md`, markdown(video));
    text(
      files,
      `${base}/transcript.json`,
      video.transcriptData ||
        JSON.stringify(
          { source: video.url, title: video.title, text: video.transcriptText },
          null,
          2
        )
    );
  }
  const cues = segments(video);
  if (cues.length) {
    text(
      files,
      `${base}/transcript.srt`,
      cues
        .map(
          (cue, index) =>
            `${index + 1}\n${timestamp(cue.start, true)} --> ${timestamp(cue.end, true)}\n${cue.text}`
        )
        .join("\n\n") + "\n"
    );
    text(
      files,
      `${base}/transcript.vtt`,
      "WEBVTT\n\n" +
        cues
          .map(
            cue =>
              `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`
          )
          .join("\n\n") +
        "\n"
    );
  }
  if (video.metadataJson)
    text(files, `${base}/metadata.json`, video.metadataJson);
  text(
    files,
    `${base}/manifest.json`,
    JSON.stringify(
      {
        status: video.status,
        url: video.url,
        title: video.title,
        channel: video.channelName,
        transcriptOrigin: video.transcriptOrigin,
        errors: video.error,
      },
      null,
      2
    )
  );
  if (video.audioKey) {
    const audio = await storage.readFile({ fileKey: video.audioKey });
    files[`${base}/audio.${video.audioFormat || "mp3"}`] = audio;
  }
  if (video.error) text(files, `${base}/NOTES.txt`, video.error);
}

async function videoForUser(id: number, userId: number) {
  const rows = await getDb()
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.userId, userId)))
    .limit(1);
  return rows[0];
}

downloads.get("/videos/:id/transcript.md", async c => {
  const user = await authenticateRequest(c.req.raw.headers).catch(
    () => undefined
  );
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const video = await videoForUser(Number(c.req.param("id")), user.id);
  if (!video?.transcriptText)
    return c.json({ error: "Transcript not found" }, 404);
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", attachment(`${safeName(video.title)}.md`));
  return c.body(markdown(video));
});

downloads.get("/videos/:filename", async c => {
  const user = await authenticateRequest(c.req.raw.headers).catch(
    () => undefined
  );
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const filename = c.req.param("filename") || "";
  const id = filename.endsWith(".zip")
    ? Number(filename.slice(0, -4))
    : Number.NaN;
  if (!Number.isInteger(id) || id <= 0)
    return c.json({ error: "A numeric video id is required" }, 400);
  const video = await videoForUser(id, user.id);
  if (
    !video ||
    (!video.audioKey && !video.transcriptText && !video.metadataJson)
  )
    return c.json({ error: "Export not found" }, 404);
  const files: ZipFiles = {};
  await appendVideo(files, video);
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", attachment(`${safeName(video.title)}.zip`));
  return c.body(Buffer.from(zipSync(files, { level: 6 })));
});

downloads.get("/jobs/:filename", async c => {
  const user = await authenticateRequest(c.req.raw.headers).catch(
    () => undefined
  );
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const filename = c.req.param("filename") || "";
  const publicId = filename.endsWith(".zip") ? filename.slice(0, -4) : "";
  if (!publicId)
    return c.json({ error: "A job id ending in .zip is required" }, 400);
  const job = await getDb()
    .select()
    .from(archiveJobs)
    .where(
      and(eq(archiveJobs.publicId, publicId), eq(archiveJobs.userId, user.id))
    )
    .limit(1);
  if (!job[0]) return c.json({ error: "Job not found" }, 404);
  const items = await getDb()
    .select()
    .from(videos)
    .where(and(eq(videos.jobId, job[0].id), eq(videos.userId, user.id)))
    .orderBy(asc(videos.id));
  const exportable = items.filter(
    video => video.audioKey || video.transcriptText || video.metadataJson
  );
  if (!exportable.length)
    return c.json({ error: "No downloadable items" }, 404);
  if (
    exportable.reduce((sum, video) => sum + video.sizeBytes, 0) >
    MAX_WEB_BUNDLE_BYTES
  ) {
    return c.json(
      {
        error:
          "This batch exceeds the 95 MB web bundle limit. Download per video or use the CLI for larger archives.",
      },
      413
    );
  }
  const files: ZipFiles = {};
  for (const video of exportable) await appendVideo(files, video);
  c.header("Content-Type", "application/zip");
  c.header(
    "Content-Disposition",
    attachment(`ArchiveShelf-${publicId.slice(0, 8)}.zip`)
  );
  return c.body(Buffer.from(zipSync(files, { level: 6 })));
});

export default downloads;
