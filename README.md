# ArchiveShelf

A source-first research archive for authorized media. Import videos, playlists, channels, or direct media URLs; keep searchable transcripts and audio; leave video files behind.

## What is included

- Responsive React library with title/channel/transcript search
- Authenticated import jobs, live progress, cancellation, and partial-failure notes
- MP3, M4A, WAV, or transcript-only exports
- TXT, Markdown, JSON, SRT, and WebVTT transcripts
- Optional `faster-whisper` fallback for missing captions
- Owner-checked audio, Markdown, per-video ZIP, and per-job ZIP downloads
- Resumable CLI with one to three workers and organized per-video folders
- Installable PWA, production server bundle, and Docker build
- Original CC0/local test suite with no third-party channel media

The UI is an original implementation informed by the supplied reference screenshots. It does not include BeyondTube branding, credits, private APIs, or unimplemented AI buttons.

## Architecture

```text
React UI ── tRPC ── authenticated job router ── Python worker ── yt-dlp / FFmpeg
   │                     │                            │
   │                     ├─ MySQL: jobs, sources, transcript text + segments
   │                     └─ Object storage: audio bytes
   │                                                    │
   └────────── owner-checked on-demand MD/ZIP ◀──────────┘
```

The standalone CLI uses the same `worker/archiveshelf.py` engine but writes directly to disk and does not require Kimi authentication, MySQL, or object storage.

## Run the web app here

The scaffold already supplies platform credentials in `.env`; never commit that file.

```bash
npm install
npm run setup:worker
npm run db:push
npm run dev
```

Open `http://localhost:3000`. For a production cold start:

```bash
npm run build
npm start
```

The build packages the frontend, bundled server, worker, and pure-Python runtime dependencies. Published hosting and object storage consume the owner’s platform quota. On-demand web ZIPs are capped at 95 MB of input audio to bound memory.

### Optional local transcription

```bash
node scripts/setup-worker.mjs --openai
```

This installs the default OpenAI Whisper backend. The tiny model downloaded successfully during verification and passed the complete audio/transcript export test. Use `--transcribe-missing --whisper-backend openai` when running the worker. For the alternative CTranslate2 backend, run `node scripts/setup-worker.mjs --transcribe` and select `--whisper-backend faster-whisper`; its Hugging Face model download timed out in this sandbox and remains unverified.

## Run the CLI

Install FFmpeg and Python 3, then:

```bash
npm run setup:worker
PYTHONPATH=.python python3 worker/archiveshelf.py archive \
  --url "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" \
  --output ./exports \
  --audio-format mp3 \
  --languages 'en.*,en' \
  --concurrency 2 \
  --max-items 25 \
  --rights-confirmed
```

Outputs follow this layout:

```text
exports/
├── index.jsonl
└── Channel name/
    └── 2026/
        └── Video title [video-id]/
            ├── audio.mp3
            ├── transcript.txt
            ├── transcript.md
            ├── transcript.json
            ├── transcript.srt
            ├── transcript.vtt
            ├── metadata.json
            └── manifest.json
```

Only requested artifacts are written. If captions are absent and local transcription is disabled, the item is correctly marked `partial`. Repeating a run skips satisfied outputs; changing audio format or enabling transcription reopens incomplete requirements.

To create a ZIP directly from a local export directory:

```bash
PYTHONPATH=.python python3 worker/archiveshelf.py bundle \
  --input ./exports --output ./exports.zip
```

## Channel inventory

The Channels page and `inventory/` contain the current summary, all imported video rows, CSV/JSON exports, and count verification. Canonical identities are accepted only with official-site or strong independent evidence. The requested exclusions remain Jamie Butler and Vivek Samtani.

Current verified coverage:

| Channel | Current scope | Earliest | Latest | Raw rows | Source items | Unique videos |
|---|---|---|---|---|---|---|
| Sounds True | YouTube unreachable in sandbox | — | — | 0 | 0 | 0 |
| Athina Król | Identity unresolved | — | — | 0 | 0 | 0 |
| SAM THE ILLUSIONIST | Official index blocked/stopped responding | — | — | 0 | 0 | 0 |
| Daniel Scranton | YouTube unreachable in sandbox | — | — | 0 | 0 | 0 |
| Pleiadian Laark… | Identity unresolved | — | — | 0 | 0 | 0 |
| Kryon Lee Carroll | Official 2019–2020 creator indexes | 2019-01-11 | 2020-03-23 | 199 | 197 | 195 |
| Rachel & Kevin P… | Identity unresolved | — | — | 0 | 0 | 0 |
| Magenta Pixie | Official archive returned HTTP 403 | — | — | 0 | 0 | 0 |
| Kristin Davies | YouTube unreachable in sandbox | — | — | 0 | 0 | 0 |
| LightingClarity | Identity unresolved | — | — | 0 | 0 | 0 |
| Saraharyana | YouTube unreachable in sandbox | — | — | 0 | 0 | 0 |
| Arkayla | YouTube unreachable in sandbox | — | — | 0 | 0 | 0 |

The three count layers are intentional: Kryon’s indexes contain 199 raw rows and 197 numbered items representing 195 distinct YouTube IDs. Four duplicate rows/links were removed. This verifies the 2019–2020 creator indexes only; it is not a claim about the channel’s complete upload count. See `inventory/CHANNELS.md`, `inventory/VIDEOS.md`, and `inventory/verification.json` for every row and error.

Regenerate the inventory and app data with:

```bash
npm run inventory -- --manifest config/channel-intake.json --output inventory --delay 1
mkdir -p public/inventory
cp inventory/channel-summary.json inventory/videos.json inventory/channels.csv inventory/videos.csv inventory/verification.json public/inventory/
```

Use `--full-metadata` for per-video YouTube metrics and `--force-network` only in an environment where public YouTube is reachable. No proxy rotation, credential harvesting, or anti-bot workaround is included. Third-party audio transcription remains disabled until archiving authorization is explicit; the existing authorized-media worker can process those sources later.

## Authorized audio archive workflow

`.github/workflows/audio-archive.yml` runs a smoke test, eight parallel shards, and one aggregation job. It first resolves creator-hosted MP3s by year, location, and title, then processes every matched row in `inventory/official-videos.csv` by default, resumes prior release bundles, prefers captions, and uses OpenAI Whisper `large-v3-turbo` by default for higher-accuracy transcription on cloud runners. It does not fall back to YouTube’s anti-bot challenge. Release assets contain per-video audio and all transcript formats; `inventory/AUDIO-STATUS.md`, `audio-manifest.csv`, `official-media-summary.json`, and `audio-verification.json` record matched, attempted, complete, partial, failed, unavailable, and resumed counts.

Run it from GitHub’s Actions tab with **Authorized audio archive → Run workflow**. A single-video smoke job must pass before any shard starts. Keep the default limit of `0` to process all 195 indexed videos, or use a small limit for another bounded test. Private-repository Actions usage, artifact storage, and release storage may incur charges.

## Test

```bash
npm run check          # TypeScript
npm run test:worker    # Python unit tests
npm run test:stress    # Local parallel/failure/resume test
npm run build          # Production bundle + cold-start assets
npm audit --omit=dev   # Production dependency audit
```

`bash scripts/stress-test.sh` generates original speech/video fixtures, starts a local HTTP server, processes three files with three workers, injects a 404, verifies that no video remains, and checks resume behavior. See [docs/TESTING.md](docs/TESTING.md) for the full live verification record and known limits.

## Docker

```bash
docker build -t archiveshelf .
docker run --env-file .env -p 3000:3000 archiveshelf
```

The image includes Node 20, Python 3, FFmpeg, the built web app, and worker dependencies. Supply production environment values at runtime; do not bake `.env` into an image.

## Source map

- `src/` — React screens, components, hooks, and styling
- `api/` — authenticated routers, job controller, storage, and download routes
- `contracts/` — validated request schemas shared across the boundary
- `db/` — Drizzle schema
- `worker/` — standalone archive engine, requirements, and unit tests
- `scripts/` — worker setup, production packaging, and reproducible stress test
- `config/` — verified and unresolved channel intake with evidence notes
- `inventory/` — generated channel/video tables, CSV/JSON, and count verification
- `docs/` — research decisions and verification evidence

## Access and licensing

Use the tool only for media you own, have permission to archive, or are otherwise authorized to copy. It does not bypass logins, paywalls, anti-bot systems, geographic restrictions, or rate limits. Restricted items fail visibly and the batch continues. Review the source platform’s current terms before archiving.

Original project code is MIT-licensed. Third-party components and reference boundaries are listed in [CREDITS.md](CREDITS.md).
