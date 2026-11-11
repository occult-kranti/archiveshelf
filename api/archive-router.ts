import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { archiveJobs, videos } from "@db/schema";
import { createArchiveSchema } from "@contracts/archive";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { cancelArchiveJob, startArchiveJob } from "./job-runner";
import { storage } from "./lib/storage";

async function ownedJob(publicId: string, userId: number) {
  const rows = await getDb()
    .select()
    .from(archiveJobs)
    .where(
      and(eq(archiveJobs.publicId, publicId), eq(archiveJobs.userId, userId))
    )
    .limit(1);
  if (!rows[0])
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Archive job not found",
    });
  return rows[0];
}

async function ownedVideo(id: number, userId: number) {
  const rows = await getDb()
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.userId, userId)))
    .limit(1);
  if (!rows[0])
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  return rows[0];
}

function publicVideo(video: typeof videos.$inferSelect) {
  return {
    id: video.id,
    jobId: video.jobId,
    url: video.url,
    title: video.title,
    channelName: video.channelName,
    duration: video.duration,
    status: video.status,
    error: video.error,
    transcriptText: video.transcriptText,
    transcriptOrigin: video.transcriptOrigin,
    hasTranscript: Boolean(video.transcriptText),
    hasAudio: Boolean(video.audioKey),
    hasBundle: Boolean(
      video.audioKey || video.transcriptText || video.metadataJson
    ),
    audioFormat: video.audioFormat,
    sizeBytes: video.sizeBytes,
    createdAt: video.createdAt,
  };
}

function publicJob(job: typeof archiveJobs.$inferSelect) {
  return {
    id: job.id,
    publicId: job.publicId,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    message: job.message,
    hasDownload: job.status === "complete" || job.status === "partial",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export const archiveRouter = createRouter({
  create: authedQuery
    .input(createArchiveSchema)
    .mutation(async ({ ctx, input }) => {
      const publicId = randomUUID();
      const options = {
        audioFormat: input.audioFormat,
        languages: input.languages,
        transcribeMissing: input.transcribeMissing,
        whisperBackend: input.whisperBackend,
        concurrency: input.concurrency,
        maxItems: input.maxItems,
      };
      const [{ id }] = await getDb()
        .insert(archiveJobs)
        .values({
          publicId,
          userId: ctx.user.id,
          options: JSON.stringify({ urls: input.urls, ...options }),
        })
        .$returningId();
      void startArchiveJob({
        jobId: id,
        publicId,
        userId: ctx.user.id,
        urls: input.urls,
        options,
      });
      return { publicId };
    }),

  jobs: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select()
      .from(archiveJobs)
      .where(eq(archiveJobs.userId, ctx.user.id))
      .orderBy(desc(archiveJobs.createdAt))
      .limit(30);
    return rows.map(publicJob);
  }),

  job: authedQuery
    .input(z.object({ publicId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return publicJob(await ownedJob(input.publicId, ctx.user.id));
    }),

  cancel: authedQuery
    .input(z.object({ publicId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await ownedJob(input.publicId, ctx.user.id);
      if (!["queued", "running"].includes(job.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only active jobs can be cancelled",
        });
      }
      await cancelArchiveJob(job.id);
      return { ok: true };
    }),

  jobDownload: authedQuery
    .input(z.object({ publicId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await ownedJob(input.publicId, ctx.user.id);
      const items = await getDb()
        .select()
        .from(videos)
        .where(and(eq(videos.jobId, job.id), eq(videos.userId, ctx.user.id)))
        .limit(1);
      if (
        !items.some(
          video => video.audioKey || video.transcriptText || video.metadataJson
        )
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No downloadable items are available for this job.",
        });
      }
      return { url: `/api/downloads/jobs/${job.publicId}.zip` };
    }),

  list: authedQuery
    .input(z.object({ search: z.string().max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await getDb()
        .select()
        .from(videos)
        .where(eq(videos.userId, ctx.user.id))
        .orderBy(desc(videos.createdAt))
        .limit(500);
      const query = input?.search?.trim().toLowerCase();
      return rows
        .filter(
          video =>
            !query ||
            [video.title, video.channelName, video.transcriptText].some(value =>
              value?.toLowerCase().includes(query)
            )
        )
        .map(publicVideo);
    }),

  byId: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return publicVideo(await ownedVideo(input.id, ctx.user.id));
    }),

  asset: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        kind: z.enum(["audio", "bundle", "transcript"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const video = await ownedVideo(input.id, ctx.user.id);
      if (input.kind === "bundle") {
        if (!video.audioKey && !video.transcriptText && !video.metadataJson)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No export is available",
          });
        return { url: `/api/downloads/videos/${video.id}.zip` };
      }
      if (input.kind === "transcript") {
        if (!video.transcriptText)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No transcript is available",
          });
        return { url: `/api/downloads/videos/${video.id}/transcript.md` };
      }
      if (!video.audioKey)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No audio export is available",
        });
      return {
        url: (
          await storage.getPresignedUrl({
            key: video.audioKey,
            download: false,
          })
        ).url,
      };
    }),
});
