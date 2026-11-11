import { z } from "zod";

export const archiveOptionsSchema = z.object({
  audioFormat: z.enum(["mp3", "m4a", "wav", "none"]).default("mp3"),
  languages: z.string().max(120).default("en.*,en"),
  transcribeMissing: z.boolean().default(false),
  whisperBackend: z.enum(["openai", "faster-whisper"]).default("openai"),
  concurrency: z.number().int().min(1).max(3).default(1),
  maxItems: z.number().int().min(1).max(50).default(25),
});

export const createArchiveSchema = archiveOptionsSchema.extend({
  urls: z.array(z.string().url().max(2048)).min(1).max(20),
  rightsConfirmed: z.literal(true),
});

export type ArchiveOptions = z.infer<typeof archiveOptionsSchema>;
export type CreateArchiveInput = z.infer<typeof createArchiveSchema>;
