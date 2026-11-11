import { authRouter } from "./auth-router";
import { archiveRouter } from "./archive-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  archive: archiveRouter,
});

export type AppRouter = typeof appRouter;
