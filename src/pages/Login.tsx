import { Archive, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function getOAuthUrl() {
  const url = new URL(
    `${import.meta.env.VITE_KIMI_AUTH_URL}/api/oauth/authorize`
  );
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  url.searchParams.set("client_id", import.meta.env.VITE_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", btoa(redirectUri));
  return url.toString();
}

export default function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-12">
      <section className="w-full max-w-md">
        <div className="mb-10 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Archive className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold">ArchiveShelf</span>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Private research workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Welcome back.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Sign in to access your source library and archive jobs.
        </p>
        <Button
          className="mt-8 h-12 w-full"
          size="lg"
          onClick={() => {
            window.location.href = getOAuthUrl();
          }}
        >
          Sign in with Kimi <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </section>
    </main>
  );
}
