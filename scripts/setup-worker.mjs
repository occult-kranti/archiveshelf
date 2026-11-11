import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const transcribe = process.argv.includes("--transcribe");
const openai = process.argv.includes("--openai");
const requirement = openai
  ? "requirements-whisper-openai.txt"
  : transcribe
    ? "requirements-transcribe.txt"
    : "requirements.txt";
const result = spawnSync(
  "python3",
  [
    "-m",
    "pip",
    "install",
    "--target",
    path.join(root, ".python"),
    "-r",
    path.join(root, "worker", requirement),
  ],
  { cwd: root, stdio: "inherit" }
);
process.exit(result.status ?? 1);
