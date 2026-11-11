import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });
cpSync(path.join(root, "worker"), path.join(dist, "worker"), {
  recursive: true,
});
const python = path.join(root, ".python");
if (existsSync(python)) {
  cpSync(python, path.join(dist, "python"), { recursive: true });
} else {
  console.warn(
    "Worker dependencies are not installed; run npm run setup:worker before production use."
  );
}
