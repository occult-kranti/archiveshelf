import {
  bigint,
  index,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export const archiveJobs = mysqlTable(
  "archive_jobs",
  {
    id: serial("id").primaryKey(),
    publicId: varchar("publicId", { length: 36 }).notNull().unique(),
    userId: bigint("userId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "cancelling",
      "complete",
      "partial",
      "failed",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    total: int("total").default(0).notNull(),
    completed: int("completed").default(0).notNull(),
    failed: int("failed").default(0).notNull(),
    options: longtext("options").notNull(),
    message: text("message"),
    outputKey: text("outputKey"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => ({ userIdx: index("archive_jobs_user_idx").on(table.userId) })
);

export const videos = mysqlTable(
  "videos",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => users.id),
    jobId: bigint("jobId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => archiveJobs.id),
    externalId: varchar("externalId", { length: 255 }),
    url: text("url").notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    channelName: varchar("channelName", { length: 255 }),
    duration: int("duration"),
    status: mysqlEnum("status", ["complete", "partial", "failed"]).notNull(),
    error: text("error"),
    transcriptText: longtext("transcriptText"),
    transcriptData: longtext("transcriptData"),
    transcriptOrigin: varchar("transcriptOrigin", { length: 255 }),
    transcriptKey: text("transcriptKey"),
    metadataJson: longtext("metadataJson"),
    audioKey: text("audioKey"),
    audioFormat: varchar("audioFormat", { length: 8 }),
    bundleKey: text("bundleKey"),
    sizeBytes: bigint("sizeBytes", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("videos_user_idx").on(table.userId),
    jobIdx: index("videos_job_idx").on(table.jobId),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ArchiveJob = typeof archiveJobs.$inferSelect;
export type Video = typeof videos.$inferSelect;
