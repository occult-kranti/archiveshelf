import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });
rmSync(path.join(dist, "worker"), { recursive: true, force: true });
cpSync(path.join(root, "worker"), path.join(dist, "worker"), { recursive: true });
const python = path.join(root, ".python");
if (existsSync(python)) {
  const archive = path.join(dist, "python.tar.gz");
  rmSync(path.join(dist, "python"), { recursive: true, force: true });
  rmSync(archive, { force: true });
  for (const args of [
    ["-czf", archive, "-C", root, ".python"],
    ["-xzf", archive, "-C", dist],
  ]) {
    const result = spawnSync("tar", args, { stdio: "inherit", timeout: 180000 });
    if (result.status !== 0) throw new Error(`tar ${args.join(" ")} failed with status ${result.status}`);
  }
  rmSync(archive, { force: true });
} else {
  console.warn("Worker dependencies are not installed; run npm run setup:worker before production use.");
}
