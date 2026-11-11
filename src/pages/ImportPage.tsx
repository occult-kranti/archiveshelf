import { useState } from "react";
import { ArrowRight, FlaskConical, Info } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/providers/trpc";

const TEST_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export default function ImportPage() {
  const navigate = useNavigate();
  const [urls, setUrls] = useState("");
  const [audioFormat, setAudioFormat] = useState<
    "mp3" | "m4a" | "wav" | "none"
  >("mp3");
  const [languages, setLanguages] = useState("en.*,en");
  const [transcribeMissing, setTranscribeMissing] = useState(false);
  const [whisperBackend, setWhisperBackend] = useState<"openai" | "faster-whisper">("openai");
  const [concurrency, setConcurrency] = useState(1);
  const [maxItems, setMaxItems] = useState(10);
  const [rights, setRights] = useState(false);
  const [error, setError] = useState("");
  const create = trpc.archive.create.useMutation({
    onSuccess: ({ publicId }) => navigate(`/jobs/${publicId}`),
    onError: cause => setError(cause.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = urls
      .split(/\s+/)
      .map(url => url.trim())
      .filter(Boolean);
    if (!parsed.length) return setError("Add at least one source URL.");
    if (parsed.some(url => !/^https?:\/\//i.test(url)))
      return setError("Every source must be an absolute HTTP(S) URL.");
    if (!rights)
      return setError(
        "Confirm that you are authorized to archive these sources."
      );
    create.mutate({
      urls: parsed,
      audioFormat,
      languages,
      transcribeMissing,
      whisperBackend,
      concurrency,
      maxItems,
      rightsConfirmed: true,
    });
  }

  return (
    <div className="max-w-4xl">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        New archive job
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        Import sources
      </h1>
      <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
        Paste videos, playlists, channels, or direct media URLs. Captions are
        fetched first; audio is extracted without retaining video files.
      </p>

      <form className="mt-8 space-y-8" onSubmit={submit}>
        <section>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="urls" className="text-base font-medium">
              Source URLs
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setUrls(
                  current => `${current}${current ? "\n" : ""}${TEST_URL}`
                )
              }
            >
              <FlaskConical className="mr-2 h-4 w-4" /> Add CC0 test source
            </Button>
          </div>
          <Textarea
            id="urls"
            className="mt-3 min-h-40 resize-y font-mono text-sm leading-6"
            value={urls}
            onChange={event => setUrls(event.target.value)}
            placeholder={
              "https://example.com/watch?v=…\nhttps://example.com/@channel…"
            }
          />
          <p className="mt-2 text-sm text-muted-foreground">
            One URL per line. Up to 20 sources and 50 discovered items per web
            job.
          </p>
        </section>

        <section className="grid gap-6 border-t pt-7 sm:grid-cols-2">
          <div>
            <Label htmlFor="audio">Audio format</Label>
            <select
              id="audio"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={audioFormat}
              onChange={event =>
                setAudioFormat(event.target.value as typeof audioFormat)
              }
            >
              <option value="mp3">MP3 · compact, compatible</option>
              <option value="m4a">M4A · original-quality friendly</option>
              <option value="wav">WAV · uncompressed, large</option>
              <option value="none">Transcripts only</option>
            </select>
          </div>
          <div>
            <Label htmlFor="languages">Caption languages</Label>
            <Input
              id="languages"
              className="mt-2 h-11 font-mono"
              value={languages}
              onChange={event => setLanguages(event.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Comma-separated preferences; en.* includes regional tracks.
            </p>
          </div>
          <div>
            <Label>Parallel workers</Label>
            <div
              className="mt-2 grid grid-cols-3 rounded-lg border p-1"
              role="group"
              aria-label="Parallel workers"
            >
              {[1, 2, 3].map(value => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setConcurrency(value)}
                  className={`min-h-9 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${concurrency === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  aria-pressed={concurrency === value}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="maximum">Maximum discovered items</Label>
            <Input
              id="maximum"
              className="mt-2 h-11"
              type="number"
              min={1}
              max={50}
              value={maxItems}
              onChange={event =>
                setMaxItems(
                  Math.max(1, Math.min(50, Number(event.target.value)))
                )
              }
            />
          </div>
        </section>

        <section className="flex items-start justify-between gap-5 border-t pt-7">
          <div>
            <Label htmlFor="whisper" className="text-base font-medium">
              Transcribe missing captions locally
            </Label>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Uses the selected Whisper backend on CPU. Optional, slower, and
              only runs when no usable caption track was exported.
            </p>
          </div>
          <Switch
            id="whisper"
            checked={transcribeMissing}
            onCheckedChange={setTranscribeMissing}
          />
        </section>

        {transcribeMissing && (
          <section className="max-w-md">
            <Label htmlFor="whisper-backend">Transcription backend</Label>
            <select
              id="whisper-backend"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={whisperBackend}
              onChange={event => setWhisperBackend(event.target.value as typeof whisperBackend)}
            >
              <option value="openai">OpenAI Whisper · verified in this workspace</option>
              <option value="faster-whisper">faster-whisper · alternative CTranslate2 backend</option>
            </select>
          </section>
        )}

        <div className="rounded-lg border bg-muted/45 p-4 text-sm leading-6 text-muted-foreground">
          <Info className="mr-2 inline h-4 w-4" /> Restricted, private,
          rate-limited, and unavailable items are recorded and skipped.
          ArchiveShelf does not rotate proxies or bypass access controls.
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="rights"
            className="mt-1"
            checked={rights}
            onCheckedChange={checked => setRights(checked === true)}
          />
          <Label htmlFor="rights" className="text-sm font-normal leading-6">
            I own these sources, have permission to archive them, or otherwise
            have authorization to make these copies.
          </Label>
        </div>

        {error && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}
        <Button
          className="min-h-12 w-full sm:w-auto"
          type="submit"
          disabled={create.isPending}
        >
          {create.isPending ? (
            "Starting archive…"
          ) : (
            <span className="flex items-center">
              Start archive <ArrowRight className="ml-2 h-4 w-4" />
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}
